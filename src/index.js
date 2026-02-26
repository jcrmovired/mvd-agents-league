const { startServer } = require("@microsoft/agents-hosting-express");
const { agentApp } = require("./agent");
const path = require("path");
const fs = require("fs");

const chartsDir = path.join(__dirname, "../files");
if (!fs.existsSync(chartsDir)) fs.mkdirSync(chartsDir, { recursive: true });

const server = startServer(agentApp);

// Serve chart images statically so Teams can display them
if (server && server.use) {
  const express = require("express");
  server.use("/charts", express.static(chartsDir));
}
