// Create or update the BetaCrux coach agent on ElevenLabs from the files in this folder.
//
//   node setup_agent.mjs           dry run: prints the requests, makes no network calls
//   node setup_agent.mjs --apply   sends them (needs ELEVENLABS_API_KEY in coach/.env)
//
// Reads prompt.md, tools.json and agent.config.json. Creates each client tool
// (or updates it if agent_ids.json already has its id), then creates or updates
// the agent with those tool ids.
//
// agent_ids.json is saved after EVERY successful create or update, so if a run
// fails halfway, re-running updates what was already created instead of making
// duplicate tools. agent_ids.json is gitignored: the repo is public and the
// agent is public, so its id should not be on GitHub.
//
// API reference (checked 2026-11-14):
//   POST  /v1/convai/tools                 {tool_config}            -> {id}
//   PATCH /v1/convai/tools/{tool_id}       {tool_config}
//   POST  /v1/convai/agents/create         {name, conversation_config} -> {agent_id}
//   PATCH /v1/convai/agents/{agent_id}     {name, conversation_config}
//   auth header: xi-api-key

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.elevenlabs.io";

function loadEnv() {
  const path = join(HERE, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

/** Prints the request and returns null. Makes no network call. */
export async function dryRunCall(method, path, body) {
  console.log(`\n[dry run] ${method} ${API}${path}`);
  console.log(JSON.stringify(body, null, 2));
  return null;
}

/** Sends the request to ElevenLabs. Only used with --apply. */
export function liveCall(apiKey) {
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
    return text ? JSON.parse(text) : {};
  };
}

/** The agent request body, given the tool ids known so far. */
export function buildAgentBody({ config, prompt, tools, toolIds, voiceId }) {
  return {
    name: config.name,
    conversation_config: {
      agent: {
        first_message: config.first_message,
        language: config.language,
        prompt: {
          prompt,
          tool_ids: tools.map((t) => toolIds[t.name] || `<id of ${t.name}>`),
        },
      },
      ...(voiceId ? { tts: { voice_id: voiceId } } : {}),
    },
  };
}

/**
 * Create or update every tool, then the agent.
 *
 * call(method, path, body) performs one request and returns the parsed response,
 * or null in a dry run. save(ids) persists ids; it is called after each
 * successful create or update, and never in a dry run (call returns null).
 */
export async function setupAgent({ call, save, ids, tools, config, prompt, voiceId, log = console.log }) {
  ids = { agent_id: ids?.agent_id ?? null, tool_ids: { ...(ids?.tool_ids || {}) } };

  for (const tool of tools) {
    const existing = ids.tool_ids[tool.name];
    if (existing) {
      const res = await call("PATCH", `/v1/convai/tools/${existing}`, { tool_config: tool });
      if (res) save(ids);
      log(`tool ${tool.name}: ${res ? "updated" : "would be updated"} ${existing}`);
    } else {
      const res = await call("POST", "/v1/convai/tools", { tool_config: tool });
      if (res) {
        if (!res.id) throw new Error(`Creating tool ${tool.name} returned no id: ${JSON.stringify(res)}`);
        ids.tool_ids[tool.name] = res.id;
        save(ids);
      }
      log(`tool ${tool.name}: ${res ? `created ${res.id}` : "would be created"}`);
    }
  }

  const agentBody = buildAgentBody({ config, prompt, tools, toolIds: ids.tool_ids, voiceId });
  if (ids.agent_id) {
    const res = await call("PATCH", `/v1/convai/agents/${ids.agent_id}`, agentBody);
    if (res) save(ids);
    log(`agent: ${res ? "updated" : "would be updated"} ${ids.agent_id}`);
  } else {
    const res = await call("POST", "/v1/convai/agents/create", agentBody);
    if (res) {
      if (!res.agent_id) throw new Error(`Creating the agent returned no agent_id: ${JSON.stringify(res)}`);
      ids.agent_id = res.agent_id;
      save(ids);
    }
    log(`agent: ${res ? `created ${res.agent_id}` : "would be created"}`);
  }
  return ids;
}

async function main() {
  const apply = process.argv.includes("--apply");
  loadEnv();
  if (apply && !process.env.ELEVENLABS_API_KEY) {
    console.error("ELEVENLABS_API_KEY is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  const idsFile = join(HERE, "agent_ids.json");
  const ids = await setupAgent({
    call: apply ? liveCall(process.env.ELEVENLABS_API_KEY) : dryRunCall,
    save: (v) => writeFileSync(idsFile, JSON.stringify(v, null, 2) + "\n"),
    ids: readJson(idsFile, null),
    tools: readJson(join(HERE, "tools.json")),
    config: readJson(join(HERE, "agent.config.json")),
    prompt: readFileSync(join(HERE, "prompt.md"), "utf8"),
    voiceId: process.env.ELEVENLABS_VOICE_ID || null,
  });
  if (apply) console.log(`\nSaved ids to agent_ids.json. Agent id: ${ids.agent_id}`);
  else console.log("\nDry run only. Nothing was sent and agent_ids.json was not written. Run with --apply to create the agent.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    console.error("Any ids created before the failure are saved in agent_ids.json; re-running will update them, not duplicate them.");
    process.exit(1);
  });
}
