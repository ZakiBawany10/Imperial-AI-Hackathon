// Tests for setup_agent.mjs using a fake request function. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupAgent, dryRunCall } from "./setup_agent.mjs";

const tools = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("./agent.config.json", import.meta.url), "utf8"));
const prompt = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");
const quiet = () => {};

/** Fake ElevenLabs: records requests, hands out ids, fails on request number `failAt` (1-based). */
function fakeApi({ failAt = null } = {}) {
  const requests = [];
  let n = 0;
  const call = async (method, path, body) => {
    n += 1;
    requests.push({ method, path, body });
    if (n === failAt) throw new Error(`simulated failure on request ${n}`);
    if (method === "POST" && path === "/v1/convai/tools") return { id: `tool_${body.tool_config.name}` };
    if (method === "POST" && path === "/v1/convai/agents/create") return { agent_id: "agent_test" };
    return {};
  };
  return { call, requests };
}

/** In-memory save that snapshots every write. */
function recorder() {
  const saves = [];
  return { saves, save: (ids) => saves.push(JSON.parse(JSON.stringify(ids))) };
}

const base = { tools, config, prompt, log: quiet };

test("ids are saved after every successful create", async () => {
  const api = fakeApi();
  const rec = recorder();
  const ids = await setupAgent({ ...base, call: api.call, save: rec.save, ids: null });
  assert.equal(rec.saves.length, tools.length + 1);
  assert.deepEqual(Object.keys(rec.saves[0].tool_ids), [tools[0].name]);
  assert.equal(ids.agent_id, "agent_test");
  const agentReq = api.requests.at(-1);
  assert.deepEqual(agentReq.body.conversation_config.agent.prompt.tool_ids, tools.map((t) => `tool_${t.name}`));
});

test("a failure halfway keeps earlier ids, and a re-run updates instead of duplicating", async () => {
  // First run: the third tool create fails.
  const rec = recorder();
  await assert.rejects(setupAgent({ ...base, call: fakeApi({ failAt: 3 }).call, save: rec.save, ids: null }));
  const saved = rec.saves.at(-1);
  assert.deepEqual(Object.keys(saved.tool_ids), [tools[0].name, tools[1].name]);
  assert.equal(saved.agent_id, null);

  // Second run from the saved ids: PATCH the two existing tools, POST only the missing one.
  const api = fakeApi();
  await setupAgent({ ...base, call: api.call, save: recorder().save, ids: saved });
  const toolPosts = api.requests.filter((r) => r.method === "POST" && r.path === "/v1/convai/tools");
  const toolPatches = api.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/convai/tools/"));
  assert.equal(toolPosts.length, 1);
  assert.equal(toolPosts[0].body.tool_config.name, tools[2].name);
  assert.equal(toolPatches.length, 2);
});

test("an existing agent is patched, not recreated", async () => {
  const api = fakeApi();
  const ids = { agent_id: "agent_old", tool_ids: Object.fromEntries(tools.map((t) => [t.name, `tool_${t.name}`])) };
  await setupAgent({ ...base, call: api.call, save: recorder().save, ids });
  assert.ok(api.requests.every((r) => r.method === "PATCH"));
  assert.equal(api.requests.at(-1).path, "/v1/convai/agents/agent_old");
});

test("dry run never saves", async () => {
  const rec = recorder();
  const origLog = console.log;
  console.log = quiet;
  try {
    await setupAgent({ ...base, call: dryRunCall, save: rec.save, ids: null });
  } finally {
    console.log = origLog;
  }
  assert.equal(rec.saves.length, 0);
});
