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

const systemPrompt = "You are an AI agent that can chat with users.";

const tools = [
  {
    type: "function",
    function: {
      name: "partirExcel",
      description: "Procesa y divide un archivo Excel en CSVs. Úsala cuando el usuario quiera partir o procesar un archivo .xlsx",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Nombre del archivo Excel, ej: Book2.xlsx" }
        },
        required: ["fileName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "retrieveKnowledgeBase",
      description: "Busca información en la knowledge base vectorial usando una consulta en lenguaje natural",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto de búsqueda semántica" }
        },
        required: ["query"]
      }
    }
  }
];

// Historial de conversaciones por conversationId
const conversationHistory = new Map();

function getHistory(conversationId) {
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, []);
  }
  return conversationHistory.get(conversationId);
}

const storage = new MemoryStorage();
const agentApp = new AgentApplication({ storage });

agentApp.onConversationUpdate("membersAdded", async (context) => {
  await context.sendActivity(`Hi there! I'm an agent to chat with you.`);
});

// Ejecutar el script Python directamente
function partirExcel(fileName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../Python-api/Script_particion_excel_to_csv.py");
    const process = spawn("python", [scriptPath, fileName]);

    let output = "";
    let error = "";

    process.stdout.on("data", (data) => output += data.toString());
    process.stderr.on("data", (data) => error += data.toString());

    process.on("close", (code) => {
      if (code === 0 || output.length > 0) {
        resolve({ message: `Archivo ${fileName} procesado correctamente` });
      } else {
        reject(new Error(error || `Proceso terminó con código ${code}`));
      }
    });
  });
}

function retrieveKnowledgeBase(query) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../Python-api/Retrieve_knowledgeBase.py");
    const process = spawn("python", [scriptPath, query]);

    let output = "";
    let error = "";

    process.stdout.on("data", (data) => output += data.toString());
    process.stderr.on("data", (data) => error += data.toString());

    process.on("close", (code) => {
      if (code === 0 || output.length > 0) {
        resolve({ message: output.trim() });
      } else {
        reject(new Error(error || `Proceso terminó con código ${code}`));
      }
    });
  });
}

agentApp.onActivity(ActivityTypes.Message, async (context) => {
  const conversationId = context.activity.conversation.id;
  const history = getHistory(conversationId);

  history.push({ role: "user", content: context.activity.text });

  const response = await client.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, ...history],
    tools,
    tool_choice: "auto",
    model: "",
  });

  const message = response.choices[0].message;

  if (message.tool_calls?.length > 0) {
    history.push(message);

    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);

      let toolResult;

      try {
      if (toolCall.function.name === "partirExcel") {
        await context.sendActivity(`Procesando el archivo ${args.fileName}...`);
        const result = await partirExcel(args.fileName);
        toolResult = result.message;
      }

      if (toolCall.function.name === "retrieveKnowledgeBase") {
        await context.sendActivity(`Buscando en la knowledge base...`);
        const result = await retrieveKnowledgeBase(args.query);
        toolResult = result.message;
      }

      } catch (err) {
        toolResult = `Error: ${err.message}`;
      }

      history.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
    }

    const finalResponse = await client.chat.completions.create({
      messages: [{ role: "system", content: systemPrompt }, ...history],
      model: "",
    });

    const answer = finalResponse.choices[0].message.content;
    history.push({ role: "assistant", content: answer });
    await context.sendActivity(answer);
  } else {
    const answer = message.content;
    history.push({ role: "assistant", content: answer });
    await context.sendActivity(answer);
  }

  if (history.length > 20) history.splice(0, 2);
});

module.exports = { agentApp };