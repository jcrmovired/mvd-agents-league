// ============================
// DEPENDENCIES
// ============================
// Agent SDK → conversation handling
// Azure OpenAI → LLM orchestration
// child_process → Python tool execution
// fs/path → local file persistence
// http/https → attachment download
// querystring → OAuth token request encoding

const { ActivityTypes } = require("@microsoft/agents-activity");
const { AgentApplication, MemoryStorage } = require("@microsoft/agents-hosting");
const { AzureOpenAI } = require("openai");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const querystring = require("querystring");
const config = require("./config");

// Azure OpenAI client used for:
// 1) Tool decision phase
// 2) Final grounded response generation
// 3) Conversation summarization

const client = new AzureOpenAI({
  apiVersion: "2024-12-01-preview",
  apiKey: config.azureOpenAIKey,
  endpoint: config.azureOpenAIEndpoint,
  deployment: config.azureOpenAIDeploymentName,
});

// In-memory cache for Bot Framework access token.
// Avoids requesting a new token on every attachment download.
let cachedBotToken = null;
let cachedBotTokenExpiresAt = 0;

// ============================
// AGENT CONFIGURATION
// ============================

// Insurance report conversational agent
// Features:
// - Tool calling (Excel ingestion + vector KB retrieval)
// - Short-term conversational memory with automatic summarization
// - RAG grounding for company data questions

const systemPrompt = `
You are an intelligent insurance report assistant that helps users understand and process tabular data.

GENERAL BEHAVIOR:
- Be helpful, clear and concise.
- Answer in the same language as the user.
- Use tools whenever an action or external data is required.
- Never invent company data.

KNOWLEDGE BASE:
- You have access to a vector knowledge base via the tool "retrieveKnowledgeBase".
- It contains insurance reports stored as CSV files.
- Data includes claims, alive policies, salvage, loss ratio, KPIs, time-based metrics, business units and categories.
- This is the single source of truth for company-specific questions.
- When asked for ratios, present them as percentages with 2 decimals, ej: 12.34%.
- when asked for economic values, present them with a euro sign and commas, ej: €1,234,567.89.

CHART GENERATION:
- You can create visualizations using the "createChart" tool.
- Use charts to help users understand data trends, comparisons, and distributions.
- Suggest appropriate chart types: bar for comparisons, line for trends, pie for proportions, scatter for correlations, histogram for distributions.
- Always provide meaningful titles and axis labels.

WHEN TO USE THE KNOWLEDGE BASE:
You MUST call the retriever when the question involves:
- insurance performance
- internal reports or documents
- company KPIs or metrics
- comparisons, trends, or time-based analysis
- any information you are not completely sure about

Do NOT answer these from your own knowledge.

AFTER RECEIVING KNOWLEDGE BASE CONTENT:
- Treat it as the source of truth.
- Extract only the relevant values.
- Perform comparisons or trend analysis when requested.
- Consider creating charts to visualize the data when appropriate.
- If the data is incomplete or missing, say:
  "I couldn't find that information in the knowledge base."
- Do NOT hallucinate or fill gaps.

EXCEL PROCESSING:
- When the user wants to process, split, ingest or learn from an Excel file, call the tool "splitExcel".
- Do not explain manual steps if the tool exists.

RESPONSE STYLE:
- Structured, clear and readable.
- Focus on insights, not raw dumps.
- Summarize long outputs.
- Use bullet points when helpful.
- Include the data source when available.
- Do not mention tools in the final answer.

CONTEXT PRIORITY:
1) Tool results
2) Conversation history
3) General knowledge (only for non-company questions)

IF A TOOL FAILS:
- Explain the issue briefly.
- Ask the user how to proceed.

GOAL:
Be accurate, analytical and fully grounded in the provided data.
`;

// Tool definitions exposed to the LLM.
// These enable function calling for:
// - Tabular data ingestion (Excel → CSV pipeline)
// - Semantic retrieval from the vector knowledge base
// - Chart generation using matplotlib
const tools = [
  {
    type: "function",
    function: {
      name: "splitExcel",
      description: "It process and divide an excel file into CSVs. Use it whenever the user wants to process or split an Excel file.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Name of Excel's file, ej: Book2.xlsx" }
        },
        required: ["fileName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "retrieveKnowledgeBase",
      description: "Searches for information in the vector knowledge base using a natural language query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Semantic search text" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "createChart",
      description: "Creates charts and visualizations from data using matplotlib. Use when user asks for graphs, charts, or visualizations.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["line", "bar", "scatter", "histogram", "pie"],
            description: "Type of chart"
          },
          title: { type: "string", description: "Chart title" },
          xAxis: {
            type: "object",
            description: "X axis config",
            properties: {
              label: { type: "string" },
              categories: { type: "array", items: { type: "string" } }
            }
          },
          yAxis: {
            type: "object",
            description: "Y axis config",
            properties: {
              label: { type: "string" }
            }
          },
          series: {
            type: "array",
            description: "Data series",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                data: { type: "array", items: { type: "number" } }
              }
            }
          }
        },
        required: ["type", "series"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "readCSV",
      description: "Runs a query over a processed CSV file. Use for count, statistics, top rows, sums or samples of a specific dataset.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "CSV file name with extension, e.g. Book2_Sheet1.csv" },
          queryType: {
            type: "string",
            enum: ["count", "describe", "head", "top", "sum", "sample"],
            description: "Type of query to run"
          },
          column: { type: "string", description: "Column name (required for top and sum)" },
          n: { type: "integer", description: "Number of rows (for head, top, sample)" }
        },
        required: ["fileName", "queryType"]
      }
    }
  }
];

// In-memory short-term conversation store.
// Each conversationId maps to an object with:
// - messages: recent interaction window (used as live context)
// - summary: compressed semantic memory of older turns
// This allows long conversations without exceeding token limits.
const conversationHistory = new Map();

// Tracks processed datasets per conversation.
// Enables the agent to understand which files are available
// and which one is currently active.
const conversationFiles = new Map();

// ============================
// AUXILIAR FUNCTIONS
// ============================

// Ensures every conversation has an isolated memory container.
// Memory is created lazily on first user interaction.
function getHistory(conversationId) {
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, {
      messages: [], // messages → sliding window of recent turns
      summary: "" // summary → LLM-generated long-term context for this conversation
    });
  }
  return conversationHistory.get(conversationId);
}

function getFiles(conversationId) {
  if (!conversationFiles.has(conversationId)) {
    conversationFiles.set(conversationId, []);
  }
  return conversationFiles.get(conversationId);
}

// Registers a processed Excel file in the conversation scope.
// The extension is removed so the base name matches the generated CSV dataset.
function addFile(conversationId, fileName) {
  const files = getFiles(conversationId);
  const fileBase = fileName.replace(/\.xlsx$/i, '');
  if (!files.includes(fileBase)) {
    files.push(fileBase);
  }
}

// ============================
// TOOLS & MEMORY MANAGEMENT
// ============================

// SDK storage (currently not used for persistence).
// Can be upgraded later to store conversation memory across restarts.
const storage = new MemoryStorage();
const agentApp = new AgentApplication({ storage });

agentApp.onConversationUpdate("membersAdded", async (context) => {
  await context.sendActivity(`Hi there! I'm an agent to chat with you.`);
});

// Executes the Excel ingestion pipeline in Python.
// Used when the user uploads or requests tabular data processing.
function splitExcel(fileName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../Python-api/Script_particion_excel_to_csv.py");
    const process = spawn("python", [scriptPath, fileName]);

    let output = "";
    let error = "";

    process.stdout.on("data", (data) => output += data.toString());
    process.stderr.on("data", (data) => error += data.toString());

    process.on("close", (code) => {
      if (code === 0) {
        resolve({ message: `File ${fileName} processed correctly. Output: ${output.trim()}` });
      } else {
        reject(new Error(error || output || `Process finished with code ${code}`));
      }
    });
  });
}

// Executes analytical queries over a processed CSV dataset.
// The query type and parameters are resolved in Python.
function ReadCSV(fileName, consultaTipo, parametros = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../Python-api/Read_CSV.py");
    const args = [scriptPath, fileName, consultaTipo];
    
    if (parametros.columna) args.push("--columna", parametros.columna);
    if (parametros.n) args.push("--n", parametros.n.toString());
    
    const process = spawn("python", args);

    let output = "";
    let error = "";

    process.stdout.on("data", (data) => output += data.toString());
    process.stderr.on("data", (data) => error += data.toString());

    process.on("close", (code) => {
      try {
        const resultado = JSON.parse(output);
        if (resultado.error) {
          reject(new Error(resultado.error));
        } else {
          resolve(resultado);
        }
      } catch (err) {
        reject(new Error(error || output || `Proceso terminó con código ${code}`));
      }
    });
  });
}

// Downloads an attachment from Teams/Bot Framework.
// Flow:
// 1) Try anonymous download
// 2) If unauthorized → request Bot Framework token
// 3) Retry with Bearer token
async function downloadFile(contentUrl, fileName) {
  return new Promise((resolve, reject) => {
    const dataRawPath = path.join(__dirname, "../Data/Data raw");
    
    // Crear directorio si no existe
    if (!fs.existsSync(dataRawPath)) {
      fs.mkdirSync(dataRawPath, { recursive: true });
    }

    const filePath = path.join(dataRawPath, fileName);

    const downloadOnce = (headers) => new Promise((resolveDownload, rejectDownload) => {
      const fileStream = fs.createWriteStream(filePath);
      const url = new URL(contentUrl);
      const protocol = url.protocol === "https:" ? https : http;

      const request = protocol.get(contentUrl, { headers }, (res) => {
        if (res.statusCode !== 200) {
          fileStream.close();
          fs.unlink(filePath, () => {});
          const error = new Error(`HTTP error! status: ${res.statusCode}`);
          error.statusCode = res.statusCode;
          rejectDownload(error);
          return;
        }
        res.pipe(fileStream);
      });

      request.on("error", (err) => {
        fileStream.close();
        fs.unlink(filePath, () => {});
        rejectDownload(err);
      });

      fileStream.on("finish", () => {
        fileStream.close();
        resolveDownload(filePath);
      }).on("error", (err) => {
        fs.unlink(filePath, () => {});
        rejectDownload(err);
      });
    });

    const tryDownload = async () => {
      try {
        return await downloadOnce({});
      } catch (err) {
        if (err.statusCode === 401 || err.statusCode === 403) {
          const token = await getBotFrameworkToken();
          if (token) {
            return await downloadOnce({ Authorization: `Bearer ${token}` });
          }
        }
        throw err;
      }
    };

    tryDownload().then(resolve).catch(reject);
  });
}

// Requests an access token using client credentials flow.
// Token is cached until shortly before expiration.
async function getBotFrameworkToken() {
  const now = Date.now();
  if (cachedBotToken && cachedBotTokenExpiresAt > now + 60000) {
    return cachedBotToken;
  }

  const clientId = process.env.clientId;
  const clientSecret = process.env.clientSecret;
  if (!clientId || !clientSecret) {
    return null;
  }

  const postData = querystring.stringify({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://api.botframework.com/.default",
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk.toString());
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Token error! status: ${res.statusCode}`));
          }
          try {
            const payload = JSON.parse(body);
            cachedBotToken = payload.access_token;
            cachedBotTokenExpiresAt = Date.now() + (payload.expires_in * 1000);
            resolve(cachedBotToken);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// Spawns the Python retrieval script.
// This bridges the Node agent with the vector knowledge base (RAG pipeline).
function retrieveKnowledgeBase(query) {

  // Debug logs for Python stdout/stderr.
  // Safe to disable in production.

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../Python-api/Retrieve_knowledgeBase.py");
    const process = spawn("python", [scriptPath, query]);

    let output = "";
    let error = "";

    // process.stdout.on("data", (data) => output += data.toString());
    // process.stderr.on("data", (data) => error += data.toString());
    process.stdout.on("data", (data) => {
      const text = data.toString();
      // console.log("🐍 PYTHON STDOUT:", text);
      output += text;
    });

    process.stderr.on("data", (data) => {
      const text = data.toString();
      // console.error("🐍 PYTHON STDERR:", text);
      error += text;
    });

    process.on("close", (code) => {
      if (code === 0 || output.length > 0) {
        resolve({ message: output.trim() });
      } else {
        reject(new Error(error || `Process finished with code ${code}`));
      }
    });
  });
}

// Creates charts using the MCP matplotlib server.
// Bridges the Node agent with the Python matplotlib MCP.
function createChart(chartArgs) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../Python-api/mcp_matplotlib.py");
    const process = spawn("python", [scriptPath]);

    let output = "";
    let error = "";

    // Send MCP request to the matplotlib server
    const mcpRequest = {
      method: "tools/call",
      params: {
        name: "create_chart",
        arguments: chartArgs
      }
    };

    process.stdin.write(JSON.stringify(mcpRequest) + "\n");
    process.stdin.end();

    process.stdout.on("data", (data) => {
      output += data.toString();
    });

    process.stderr.on("data", (data) => {
      error += data.toString();
    });

    process.on("close", (code) => {
      console.log("MCP exit code:", code);
      console.log("MCP stdout:", output.trim().substring(0, 300));
      console.log("MCP stderr:", error.trim().substring(0, 300));
      try {
        if (output.trim()) {
          const result = JSON.parse(output.trim());
          if (result.content && result.content[0]) {
            resolve({ message: result.content[0].text, imageData: result.content[1]?.data });
          } else {
            resolve({ message: "Chart created successfully" });
          }
        } else {
          reject(new Error(error || `Process finished with code ${code}`));
        }
      } catch (err) {
        reject(new Error(`Failed to parse MCP response: ${err.message}. Raw output: ${output.trim().substring(0, 200)}`));
      }
    });
  });
}

// Removes prompt injection / spam patterns from any text before sending to chat or memory
function sanitizeText(text) {
  if (!text) return text;
  // Remove lines containing Chinese chars, spam patterns, or tool injection attempts
  return text
    .split('\n')
    .filter(line => !/[\u4e00-\u9fff\u0e00-\u0e7f]/.test(line))
    .filter(line => !/to=functions\.|commentary|json\s*$|天天|彩票|快三|赛车/i.test(line))
    .join('\n')
    .trim();
}


// Converts the full recent interaction window into a compact semantic summary.
// This summary is injected as system context in subsequent turns.
async function summarizeConversation(memory) {
  const text = memory.messages
  .map(m => {
    if (m.content) return `${m.role}: ${m.content}`;
    if (m.tool_calls) return `${m.role}: [tool call]`;
    return `${m.role}:`;
  })
  .join("\n");

  const response = await client.chat.completions.create({
    model: config.azureOpenAIDeploymentName,
    messages: [
      {
        role: "system",
        content:
          "Summarize the conversation for an insurance data assistant. Keep business units, time periods, metrics, user goals and analysis context."
      },
      { role: "user", content: text }
    ]
  });

  memory.summary = response.choices[0].message.content;
}


// ============================
// AGENT EXCECUTION
// ============================

// Main agent orchestration loop.
// Responsibilities:
// 1) Attachment ingestion
// 2) Memory update
// 3) Tool decision phase
// 4) Tool execution
// 5) Final grounded response
// 6) Context compression

agentApp.onActivity(ActivityTypes.Message, async (context) => {
  const conversationId = context.activity.conversation.id;
  const memory = getHistory(conversationId);
  const userText = context.activity.text || "";

  // ============================
  // ATTACHMENT AUTO-PROCESSING
  // ============================

  // Automatic Excel ingestion flow.
  // If a file is uploaded:
  // - Download if not already stored
  // - Process into CSV datasets
  // - Register as active dataset for the conversation

  if (context.activity.attachments && context.activity.attachments.length > 0) {
    const attachment = context.activity.attachments[0];
    const fileName = attachment.name;

    const downloadUrl =
      (attachment.content && attachment.content.downloadUrl) ||
      attachment.contentUrl;

    if (fileName && fileName.match(/\.xlsx$/i)) {
      await context.sendActivity(`📎 File received: ${fileName}. Processing...`);

      try {
        const filePath = path.join(__dirname, "../Data/Data raw", fileName);

        if (!fs.existsSync(filePath)) {
          if (!downloadUrl) {
            throw new Error("No download URL found for the attachment.");
          }

          await downloadFile(downloadUrl, fileName);
        }

        const result = await splitExcel(fileName);

        await context.sendActivity(result.message);

        // Save file in conversation memory
        memory.lastProcessedFile = fileName.replace(/\.xlsx$/i, "");
        addFile(conversationId, fileName);

        // If user sent only the file → stop here
        if (!userText.trim()) {
          return;
        }

        // If there is text → continue normal agent flow

      } catch (err) {
        await context.sendActivity(`❌ Error processing file: ${err.message}`);
        return;
      }
    }
  }

  // Store the raw user message as part of the conversational working memory.
  // This is the freshest and most relevant context for the model.
  memory.messages.push({
    role: "user",
    content: userText
  });

  // Injects the currently active dataset into the system context.
  // Enables follow-up analytical questions without repeating the file name.

  const fileContext = memory.lastProcessedFile
    ? [{
        role: "system",
        content: `Last processed file: ${memory.lastProcessedFile}.
      Use this file as the default data source for follow-up analytical questions unless the user specifies a different file.`
      }]
    : [];

  // Compose the full prompt for the LLM.
  // Order is important:
  // 1) System prompt → behavior and domain rules
  // 2) Conversation summary → long-term semantic memory
  // 3) Recent messages → current working context
  const messagesForModel = [
    { role: "system", content: systemPrompt },
    ...(memory.summary
      ? [{ role: "system", content: `Conversation summary:\n${memory.summary}` }]
      : []),
    ...fileContext,
    ...memory.messages
  ];

  // First LLM call:
  // The model decides whether it can answer directly
  // or needs to call a tool (function calling phase).
  const response = await client.chat.completions.create({
    messages: messagesForModel,
    tools,
    tool_choice: "auto",
    model: config.azureOpenAIDeploymentName,
  });

  const message = response.choices[0].message;
  console.log("LLM finish_reason:", response.choices[0].finish_reason, "| tool_calls:", message.tool_calls?.length ?? 0);

  // Detect when model returns tool call as plain text instead of tool_calls
  if (!message.tool_calls?.length && message.content) {
    let parsed = null;
    try { parsed = JSON.parse(message.content.trim()); } catch (_) {}
    if (parsed && (parsed.series || parsed.xAxis || parsed.chartType || parsed.chart_type)) {
      // Model returned chart JSON as text — execute it manually
      const fakeArgs = parsed;
      await context.sendActivity(`Creating chart: ${fakeArgs.title || ''}...`);
      try {
        const result = await createChart(fakeArgs);
        if (result.imageData) {
          const filesDir = path.join(__dirname, "../files");
          if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
          const chartFileName = `chart_${Date.now()}.png`;
          fs.writeFileSync(path.join(filesDir, chartFileName), Buffer.from(result.imageData, 'base64'));
          const port = process.env.PORT || 3978;
          await context.sendActivity(`![${fakeArgs.title || 'Chart'}](http://localhost:${port}/charts/${chartFileName})`);
        } else {
          await context.sendActivity(result.message || "Chart created.");
        }
      } catch (err) {
        await context.sendActivity(`Error creating chart: ${err.message}`);
      }
      memory.messages.push({ role: "assistant", content: `Chart created: ${fakeArgs.title || ""}` });
      return;
    }
  }

  // Store the tool call request as part of the reasoning trace.
  // This keeps the conversation coherent for multi-step tool usage.
  if (message.tool_calls?.length > 0) {
    memory.messages.push({
      role: "assistant",
      tool_calls: message.tool_calls,
      content: message.content || null
    });

    // Execute each requested tool and capture its output.
    // The result is pushed into memory as a "tool" role message
    // so the LLM can use it in the final answer.
    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);

      let toolResult;

      try {
      if (toolCall.function.name === "splitExcel") {
        await context.sendActivity(`Processing the file ${args.fileName}...`);
        const result = await splitExcel(args.fileName);
        toolResult = result.message;
      }

      if (toolCall.function.name === "retrieveKnowledgeBase") {
        await context.sendActivity(`Searching in the knowledge base...`);
        const result = await retrieveKnowledgeBase(args.query);
        toolResult = sanitizeText(result.message);
      }

      if (toolCall.function.name === "readCSV") {
        await context.sendActivity(`Reading CSV data...`);
        const result = await ReadCSV(args.fileName, args.queryType, { columna: args.column, n: args.n });
        toolResult = JSON.stringify(result);
      }

      if (toolCall.function.name === "createChart") {
        await context.sendActivity(`Creating chart: ${args.title || args.chartType || args.chart_type}...`);
        const result = await createChart(args);
        toolResult = result.message || "Chart created.";

        if (result.imageData) {
          await context.sendActivity({
            type: 'message',
            attachments: [{
              contentType: 'image/png',
              contentUrl: `data:image/png;base64,${result.imageData}`,
              name: `chart_${Date.now()}.png`
            }]
          });

          memory.messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Chart created and displayed." });
          memory.messages.push({ role: "assistant", content: `Here is the chart: ${args.title || ""}` });
          return;
        }
      }

      } catch (err) {
        toolResult = `Error: ${err.message}`;
        console.log("TOOL ERROR:", toolCall.function.name, err.message);
      }

      console.log("TOOL RESULT for", toolCall.function.name, ":", String(toolResult).substring(0, 200));
      
      memory.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult ?? "Done."
      });
    }

    // Rebuild the prompt including tool results.
    // The model now generates a grounded, final user-facing answer.
    const messagesForFinalModel = [
      { role: "system", content: systemPrompt },
      ...(memory.summary
        ? [{ role: "system", content: `Conversation summary:\n${memory.summary}` }]
        : []),
      ...fileContext,
      ...memory.messages
    ];

    // Second LLM call:
    // Grounded response generation.
    // The model answers using:
    // - Tool outputs
    // - Conversation memory
    // - Active dataset context
    
    const finalResponse = await client.chat.completions.create({
      messages: messagesForFinalModel,
      model: config.azureOpenAIDeploymentName,
    });

    const answer = sanitizeText(finalResponse.choices[0].message.content);
    memory.messages.push({ role: "assistant", content: answer });
    await context.sendActivity(answer);
  } else {
    const answer = sanitizeText(message.content);
    memory.messages.push({ role: "assistant", content: answer });
    await context.sendActivity(answer);
  }

  // When the sliding window grows too large:
  // 1) Summarize the full conversation into semantic memory
  // 2) Keep only the most recent turns
  // This maintains context while controlling token usage.
  if (memory.messages.length > 12) {

    // Uses the LLM to compress older conversation turns into a structured summary.
    // The summary preserves analytical context (business unit, period, KPIs, user intent).
    await summarizeConversation(memory);

    memory.messages = memory.messages.slice(-6);
  }
});

module.exports = { agentApp };