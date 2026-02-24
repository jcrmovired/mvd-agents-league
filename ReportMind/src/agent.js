const { ActivityTypes } = require("@microsoft/agents-activity");
const { AgentApplication, MemoryStorage } = require("@microsoft/agents-hosting");
const { AzureOpenAI } = require("openai");
const fetch = require("node-fetch");

const config = require("./config");

const client = new AzureOpenAI({
  apiVersion: "2024-12-01-preview",
  apiKey: config.azureOpenAIKey,
  endpoint: config.azureOpenAIEndpoint,
  deployment: config.azureOpenAIDeploymentName,
});

const systemPrompt = "You are an AI agent that can chat with users.";

// Storage
const storage = new MemoryStorage();
const agentApp = new AgentApplication({ storage });

agentApp.onConversationUpdate("membersAdded", async (context) => {
  await context.sendActivity(`Hi there! I'm an agent to chat with you.`);
});

// 🧠 FUNCIÓN QUE LLAMA A PYTHON
async function partirExcel(fileName) {
  const response = await fetch("http://127.0.0.1:8000/partir-excel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_name: fileName }),
  });

  return await response.json();
}

// 🎯 MENSAJES
agentApp.onActivity(ActivityTypes.Message, async (context) => {
  const userText = context.activity.text;

  // 🔍 detectar intención simple
  const match = userText.match(/([\w-]+\.xlsx)/i);

  if (userText.toLowerCase().includes("parte") && match) {
    const fileName = match[1];

    await context.sendActivity(`Procesando el archivo ${fileName}...`);

    try {
      const result = await partirExcel(fileName);
      await context.sendActivity(result.message || "Archivo procesado ✅");
    } catch (err) {
      await context.sendActivity("❌ Error al procesar el archivo");
    }

    return;
  }

  // 💬 CHAT NORMAL (lo que ya tenías)
  const result = await client.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
    model: "",
  });

  let answer = "";
  for (const choice of result.choices) {
    answer += choice.message.content;
  }

  await context.sendActivity(answer);
});

module.exports = { agentApp };