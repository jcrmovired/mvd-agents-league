const { ActivityTypes } = require("@microsoft/agents-activity");
const { AgentApplication, MemoryStorage } = require("@microsoft/agents-hosting");
const { AzureOpenAI } = require("openai");
const { spawn } = require("child_process");
const path = require("path");

const config = require("./config");

const client = new AzureOpenAI({
  apiVersion: "2024-12-01-preview",
  apiKey: config.azureOpenAIKey,
  endpoint: config.azureOpenAIEndpoint,
  deployment: config.azureOpenAIDeploymentName,
});


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
- If the data is incomplete or missing, say:
  "I couldn't find that information in the knowledge base."
- Do NOT hallucinate or fill gaps.

EXCEL PROCESSING:
- When the user wants to process, split, ingest or learn from an Excel file, call the tool "partirExcel".
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
  }
];

// In-memory short-term conversation store.
// Each conversationId maps to an object with:
// - messages: recent interaction window (used as live context)
// - summary: compressed semantic memory of older turns
// This allows long conversations without exceeding token limits.
const conversationHistory = new Map();

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

// LLM-powered conversation compression.
// Converts the full recent interaction window into a compact semantic summary.
// This summary is injected as system context in subsequent turns.
async function summarizeConversation(memory) {
  const text = memory.messages
    .map(m => `${m.role}: ${m.content}`)
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

agentApp.onActivity(ActivityTypes.Message, async (context) => {
  const conversationId = context.activity.conversation.id;
  const memory = getHistory(conversationId);

  // Store the raw user message as part of the conversational working memory.
  // This is the freshest and most relevant context for the model.
  memory.messages.push({
    role: "user",
    content: context.activity.text
  });

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

  // Store the tool call request as part of the reasoning trace.
  // This keeps the conversation coherent for multi-step tool usage.
  if (message.tool_calls?.length > 0) {
    memory.messages.push({
      role: "assistant",
      tool_calls: message.tool_calls
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
        toolResult = result.message;
      }

      } catch (err) {
        toolResult = `Error: ${err.message}`;
      }
      
      // Tool output becomes the single source of truth for the next model call.
      // This is the core of the RAG grounding mechanism.
      memory.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult
      });
    }

    // Rebuild the prompt including tool results.
    // The model now generates a grounded, final user-facing answer.
    const messagesForFinalModel = [
      { role: "system", content: systemPrompt },
      ...(memory.summary
        ? [{ role: "system", content: `Conversation summary:\n${memory.summary}` }]
        : []),
      ...memory.messages
    ];

    // Second LLM call:
    // Generates the final response using tool outputs as context.
    const finalResponse = await client.chat.completions.create({
      messages: messagesForFinalModel,
      model: config.azureOpenAIDeploymentName,
    });

    const answer = finalResponse.choices[0].message.content;
    // Persist the assistant response in the short-term memory
    // so follow-up questions can reference it.
    memory.messages.push({ role: "assistant", content: answer });
    await context.sendActivity(answer);
  } else {
    const answer = message.content;
    // Persist the assistant response in the short-term memory
    // so follow-up questions can reference it.
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