# 🧠 Agentic Search O11y Autotune

A Mastra-based demo that showcases agentic search relevance tuning using observability signals. Built with [Mastra](https://github.com/mastra-ai/mastra), Elasticsearch, and OpenAI.

---

## 📦 Project Structure

This repo uses:

- `mastra` for workflow orchestration
- `@mastra/*` packages for memory, logging, and tool integration
- `@elastic/elasticsearch` for search backend
- `zod` for schema validation
- `pino` for structured logging
- TypeScript + `tsx` for dev ergonomics

---

## 🚀 Getting Started

### ✅ Prerequisites

- **Node.js** `>= 20.9.0`
- **Git**
- Optional: [Bun](https://bun.sh) or [Volta](https://volta.sh) for managing Node versions

---

### 📥 Install

```bash
git clone https://github.com/jwilliams-elastic/agentic-search-o11y-autotune.git
cd agentic-search-o11y-autotune
npm install
```

---

### ⚙️ Setup

1. Create 2 serverless projects
   - Elasticsearch optimized for vectors 
      - you will need to obtain URL for `.env` `ELASTIC_URL` entry
      - you will need to create an API key for `.env` `ELASTIC_API_KEY` entry 
   - Elastic for Observability
      - you will need to obtain URL for `elastic-agent-reference.yml` `hosts` config
      - you will need to create an API key for `elastic-agent-reference.yml` `api_key` config

1. Create a `.env` file:

```bash
cp .env.example .env
```

2. Populate `.env` with values for:
   - OpenAI API Key
   - Elasticsearch endpoint/credentials
   - Absolulte path for data file

3. Import `sample_kibana_dashboard.ndjson` into your elasticsearch environment
   - Open Kibana and navigate to Stack Management -> Saved Objects
   - Click "Import" 
   - Select file and click "Import"

---

### 🛠 Run Mastra and elastic-agent

| Command                                    | Description                              |
|--------------------------------------------|------------------------------------------|
| `npm run dev`                              | Run Mastra in dev mode (hot reload)      |
| `cd elastic-agent && ./elastic-agent run`  | Start Elastic Agent                      |

---

## 🧪 Demo Flow

1. Open http://localhost:4111/workflows
2. Run 'elastic-setup-workflow' (.env file has default values but you can override in mastra UI)
3. Open http://localhost:4111/agents
4. Test the home search agent with a query like "homes 10mi from disney world fl under 500K"
5. Open the "Agentic Search Analytics" dashboard in kibana to see usage details 

## 🧪 Development Notes

- Code is written in [TypeScript](https://www.typescriptlang.org/)
- Mastra workflows and tools live in `/src`
- Logs use [pino-pretty](https://github.com/pinojs/pino-pretty) during development
- Logs are shipped to Elasticsearch (can be same or different from search cluster)

---

## 📁 Folder Structure

```
agentic-search-o11y-autotune/
├── src/                               # Mastra tools & workflows
├── .env.example                       # Template for env vars
├── package.json                       # Project metadata and scripts
├── tsconfig.json                      # TypeScript config
├── elastic-agent-reference.yml        # Sample elastic agent config for search analytics
├── sample_kibana_dashboard.ndjson     # Sample kibana dashboard for search analytics
└── README.md            # You're here
```

---

## 📊 Observability Features

This demo includes:

- Search event logging (Mastra logger + pino)
- Search tuning hooks
- Elasticsearch query templates
- Basic analytics-ready output for ES|QL dashboards

---

## 🧪 Test Data & Monitoring

You can ship logs to an Elasticsearch instance using a local elastic-agent. The agent can be downloaded from [here](https://www.elastic.co/downloads/elastic-agent).

You can use [elastic-agent-reference.yml](./elastic-agent-reference.yml) to configure the agent. You will need to specify values for any entries that start with "YOUR" 

```bash
./elastic-agent run
```

And inspect logs or trace behavior as needed.

---

## 🧩 Mastra Version Compatibility

This project uses:

- `mastra@^0.10.12`
- Be sure to install the CLI globally if needed:

```bash
npm install -g mastra
```

---

## 🙋‍♀️ Questions or Issues?

Create a github issue or email repo maintainers.
