const { ActivityTypes } = require("@microsoft/agents-activity");
const { AgentApplication, MemoryStorage } = require("@microsoft/agents-hosting");
const { AzureOpenAI, OpenAI } = require("openai");

const config = require("./config");

const client = new AzureOpenAI({
  apiVersion: "2024-12-01-preview",
  apiKey: config.azureOpenAIKey,
  endpoint: config.azureOpenAIEndpoint,
  deployment: config.azureOpenAIDeploymentName,
});
const systemPrompt = "You are an AI agent that can chat with users.";

// Define storage and application
const storage = new MemoryStorage();
const agentApp = new AgentApplication({
  storage,
});

agentApp.onConversationUpdate("membersAdded", async (context) => {
  await context.sendActivity(`Hi there! I'm an agent to chat with you.`);
});

// Listen for ANY message to be received. MUST BE AFTER ANY OTHER MESSAGE HANDLERS
agentApp.onActivity(ActivityTypes.Message, async (context) => {
  // Echo back users request
  const result = await client.chat.completions.create({
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: context.activity.text,
      },
    ],
    model: "",
  });
  let answer = "";
  for (const choice of result.choices) {
    answer += choice.message.content;
  }
  await context.sendActivity(answer);
});

module.exports = {
  agentApp,
};