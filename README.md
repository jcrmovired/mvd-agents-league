<table border="0"><tr><td><img src="logo_report_mind.png" height="80"/></td><td><h1>ReportMind</h1></td></tr></table>

> 🏆 **Microsoft Agents League — Enterprise Agents Track Submission**
> Built by team **MV Dataworks** for the [Enterprise Agents competition](https://github.com/microsoft/agentsleague/tree/main/starter-kits/3-enterprise-agents)

It’s Friday. Two hours left before you’re free ⏳. Your brain is already planning tomorrow’s breakfast — croissant or toast with tomato 🥐🍅 — when suddenly… *ping* 🔔

An Excel file lands in your inbox.

Ten sheets. Ten thousand cells each. Random colors 🎨. Formulas pointing to places that no longer exist 🧭.  
The message says: *“Can you check a few parameters? We can’t find them.”* 😐

You sigh 😮‍💨, open your wallet, and subscribe to yet another “revolutionary” tool that promises to *read tabular data*, *talk to your Excel*, and *change the way you work* 🚀.  
€30/month later, and 15 minutes after that… it’s your **53rd disappointment** 💸.

Has this ever happened to you?

Yeah. Us too 🤝.

So we built this agent.

One that actually opens the file 📂.  
Actually understands the data 🧠.  
And actually answers your questions — without forcing you to become an archaeologist of cells 🏺.

Meet **ReportMind** — the AI agent that doesn’t ruin your Fridays 🎉.

**ReportMind** ingests real Excel reports, splits them by sheet into structured CSV datasets, embeds them into a vector knowledge base, and lets you ask questions in plain language — getting back accurate, grounded answers with no SQL, no dashboards, and no data engineering required ⚡.

### ✨ What we bring to the table

- 📊 Reads large, messy Excel files without complaining  
- 🔍 Finds the KPIs people swear are “somewhere in there”  
- 🧠 Understands tabular data in context  
- 💬 Lets you ask questions in plain language  
- ⚡ Saves you from manual scrolling-induced despair  

### 🧘‍♂️ What this agent does *not* do

- Judge your spreadsheet structure 🙃  
- Ask why there are merged cells inside pivot tables  
- Tell anyone how long it actually took you to find that number 🤫  

Ask *"What was the loss ratio for the automotive business unit in Q3?"* and ReportMind will find the answer in your real data, explain it, and visualize it 📈 — all in a single conversation turn.

---

## Inspiration

One of the biggest unsolved challenges in enterprise AI today is **tabular data**. LLMs are great at text — but when the source of truth lives in Excel spreadsheets, CSV exports, or business reports, most agents fail. They either hallucinate numbers, cannot navigate multi-sheet files, or require expensive data pipelines before they can answer a single question.

In practice, Excel files are the Achilles’ heel of modern generative AI. Every attempt to analyze them introduces a new obstacle: files are too large, sheets are too complex, rows and columns are too numerous, or the relevant information is hidden somewhere else. The list of issues when working with LLMs on spreadsheets is almost endless. That is why we built this project — to propose a practical solution to this problem.

We present a prototype designed specifically for working with Excel files, where file size is no longer a limitation thanks to our preprocessing and chunking strategy. In addition, our approach improves the understanding of tabular data regardless of the original spreadsheet structure by transforming implicit context into explicit, semantically meaningful text, which substantially enhances retrieval performance. Finally, we extended the agent with chart generation and document memory capabilities to provide a more natural and productive user experience.

Although this is still an early-stage version, we believe our approach can help push the boundaries of how LLMs understand Excel data and significantly simplify everyday analytical workflows in enterprise environments.

---

## Competition Requirements ✅

This project was built for the **Enterprise Agents** track using the **M365 Agents Toolkit**.

| Requirement | How we meet it |
|---|---|
| Built with M365 Agents Toolkit | ✅ Node.js agent using `@microsoft/agents-hosting` + `@microsoft/agents-hosting-express` |
| Deployable to Microsoft 365 / Teams | ✅ Azure Bot Service + Azure App Service via Bicep infra (`infra/`) |
| Includes a README | ✅ This file |
| Public repository | ✅ |
| Demo video | ✅ See below |

### Judging rubric alignment

| Criterion | Our approach |
|---|---|
| **Accuracy & Relevance (20%)** | RAG over real insurance Excel reports via ChromaDB — answers are grounded in actual company data, never hallucinated |
| **Reasoning & Multi-step Thinking (20%)** | Two-phase LLM loop: tool decision → tool execution → grounded response. Chains KB retrieval + chart generation in a single turn |
| **Creativity & Originality (15%)** | Custom MCP matplotlib server for on-demand chart generation directly in chat; Excel ingestion via file upload without leaving the conversation |
| **User Experience & Presentation (15%)** | Natural language interface — no SQL, no dashboards. Conversational memory with automatic summarization keeps context across long sessions. Best experienced in **Microsoft Teams** with full file upload and chart rendering support |
| **Reliability & Safety (20%)** | Sliding window memory prevents token overflow; tool errors are caught and reported gracefully; LLM is never the source of truth for company data |
| **Community vote (10%)** | [Vote for us on Discord →](https://aka.ms/agentsleague/discord) |

---

## 🌟 Features

- **📂 Excel ingestion via chat** — Upload `.xlsx` files directly in Teams. The agent splits them by sheet into CSV datasets and indexes them automatically
- **🔍 RAG over tabular data** — Ask any question about your reports. ChromaDB retrieves the most relevant data chunks and the LLM answers from them — never from its own knowledge
- **📈 On-demand chart generation** — Ask for a bar chart, line graph, or pie chart and get a PNG image back in the same message, powered by a custom MCP matplotlib server
- **🧠 Conversational memory** — The agent remembers context across turns. When the conversation grows long, it auto-summarizes to stay within token limits without losing context

---

## 💬 Usage Examples

Type naturally in Teams or the Agents Playground:

```
"What was the total number of new policies in Q3 2025?"

"Show me the loss ratio trend for the automotive business unit across all months"

"Create a bar chart comparing claims by business unit for 2025"

"Upload this Excel report and tell me which product had the highest sales volume"

"What are the top 3 KPIs from the last processed report?"
```

The agent will:
1. Search the knowledge base for relevant data
2. Generate a grounded, accurate answer
3. Optionally create a chart to visualize the results — all in one turn

---

## 🏗️ Architecture

```
User (Teams / Agents Playground)
        │
        ▼
  Node.js Agent (Microsoft 365 Agents SDK)
        │
        ├── Azure OpenAI (GPT-4o) ──► Tool decision + grounded response
        │
        ├── Tool: retrieveKnowledgeBase
        │         └── Python → ChromaDB vector store (RAG)
        │
        ├── Tool: createChart
        │         └── Python MCP server → matplotlib → PNG
        │
        └── Tool: splitExcel
                  └── Python → Excel → CSV pipeline → ChromaDB ingestion
```

### Components

1. **Node.js Agent** (`src/agent.js`) — Main orchestration loop. Handles tool calling, memory management, and response generation via Azure OpenAI function calling
2. **RAG Retriever** (`Python-api/Retrieve_knowledgeBase.py`) — Semantic search over ChromaDB. Returns the top-K most relevant chunks for each query
3. **MCP Matplotlib Server** (`Python-api/mcp_matplotlib.py`) — Standalone MCP server that normalizes any chart JSON the LLM produces and returns a PNG image
4. **Excel Ingestion Pipeline** (`Python-api/Script_particion_excel_to_csv.py`) — Splits multi-sheet Excel files into CSV datasets, chunks them, and indexes them into ChromaDB

---

## 🚀 Setup

### Prerequisites

- Node.js 18, 20, or 22
- Python 3.10+
- [Microsoft 365 Agents Toolkit VS Code Extension](https://aka.ms/teams-toolkit)
- Azure OpenAI resource with a GPT-4o deployment and an embeddings deployment

### 1. Configure environment

In `env/.env.playground.user`:

```
SECRET_AZURE_OPENAI_API_KEY=<your-key>
AZURE_OPENAI_ENDPOINT=<your-endpoint>
AZURE_OPENAI_DEPLOYMENT_NAME=<your-gpt-deployment>
AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME=<your-embedding-deployment>
```

For local Teams testing, also create `env/.env.local.user`:

```
SECRET_BOT_PASSWORD=<your-bot-password>
SECRET_AZURE_OPENAI_API_KEY=<your-key>
AZURE_OPENAI_ENDPOINT=<your-endpoint>
AZURE_OPENAI_DEPLOYMENT_NAME=<your-gpt-deployment>
```

### 2. Install dependencies

```bash
npm install
pip install -r Python-api/requirements.txt
```

### 3. Run locally

Press `F5` in VS Code and select **Debug in Teams** for the full experience (file upload + chart rendering).

> The agent works best in **Microsoft Teams** — it supports Excel file uploads directly in the chat. The Agents Playground can be used for quick testing but has limited attachment support.

### 4. Deploy to Azure

The project includes Bicep templates (`infra/`) that provision all required Azure resources: an App Service, a Bot Service registration, and a Managed Identity.

**1. Set your Azure credentials** in `env/.env.dev.user`:
```
AZURE_SUBSCRIPTION_ID=<your-subscription-id>
AZURE_RESOURCE_GROUP_NAME=<your-resource-group>
SECRET_AZURE_OPENAI_API_KEY=<your-key>
AZURE_OPENAI_ENDPOINT=<your-endpoint>
AZURE_OPENAI_DEPLOYMENT_NAME=<your-gpt-deployment>
```

**2. Provision and deploy** using the M365 Agents Toolkit:
```bash
# Provision Azure resources (App Service + Bot registration)
npx teamsapp provision --env dev

# Deploy the application
npx teamsapp deploy --env dev

# Publish to Teams Admin Center for org-wide rollout
npx teamsapp publish --env dev
```

Or use the **M365 Agents Toolkit panel** in VS Code → `Provision` → `Deploy` → `Publish`.

After publishing, the app appears in Teams Admin Center for approval and can be pinned org-wide.

---

## 📁 Project structure

```
ReportMind/
├── src/
│   ├── index.js          # Express server + static chart serving
│   ├── agent.js          # Agent orchestration, tools, memory
│   └── config.js         # Environment config
├── Python-api/
│   ├── mcp_matplotlib.py              # MCP chart generation server
│   ├── Retrieve_knowledgeBase.py      # ChromaDB RAG retriever
│   ├── Script_particion_excel_to_csv.py  # Excel ingestion pipeline
│   └── requirements.txt
├── Data/
│   ├── Data raw/          # Uploaded Excel files
│   ├── Data processed/    # Generated CSV datasets
│   └── KnowledgeBase/     # ChromaDB vector store
├── infra/                 # Azure Bicep deployment templates
└── appPackage/            # Teams app manifest
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Agent runtime | [Microsoft 365 Agents SDK](https://github.com/Microsoft/Agents) (Node.js) |
| LLM | Azure OpenAI (GPT-4o) |
| Vector store | ChromaDB + Azure OpenAI Embeddings |
| Chart generation | Python MCP server + matplotlib |
| Data ingestion | Python + openpyxl + LangChain |
| Deployment | Azure Bot Service + Azure App Service |

---

## Team

**MV Dataworks** — Microsoft Agents League 2025

| Name | Role | Github |
|---|---|---|
| Johanna Capote Robayna | AI & BI Manager | [@jcrmovired](https://github.com/jcrmovired) |
| Nathaniel Capote Robayna | AI Engineer | [@nathaniel-mv](https://github.com/jcrmovired) |
| Loreto Lopez Peralta | Data Analytics | [@LoretoMovired](https://github.com/jcrmovired) |
| Javier Martin Luque | Software Developer | [@JaviMartinLuque](https://github.com/jcrmovired) |
