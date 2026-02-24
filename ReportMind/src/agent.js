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

agentApp.onActivity(ActivityTypes.Message, async (context) => {
  const userText = context.activity.text;

  const match = userText.match(/([\w-]+\.xlsx)/i);

  if (userText.toLowerCase().includes("parte") && match) {
    const fileName = match[1];

    await context.sendActivity(`Procesando el archivo ${fileName}...`);

    try {
      const result = await partirExcel(fileName);
      await context.sendActivity(result.message);
    } catch (err) {
      await context.sendActivity(`❌ Error al procesar el archivo: ${err.message}`);
    }

    return;
  }

  const conversationId = context.activity.conversation.id;
  const history = getHistory(conversationId);

  // Añadir mensaje del usuario al historial
  history.push({ role: "user", content: userText });

  const result = await client.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
    ],
    model: "",
  });

  let answer = "";
  for (const choice of result.choices) {
    answer += choice.message.content;
  }

  // Añadir respuesta del agente al historial
  history.push({ role: "assistant", content: answer });

  // Limitar historial a últimos 20 mensajes para no exceder tokens
  if (history.length > 20) history.splice(0, 2);

  await context.sendActivity(answer);
});

module.exports = { agentApp };