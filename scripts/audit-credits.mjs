#!/usr/bin/env node
// Read-only provider/model audit for credits.json and locally configured Pi models.
// Default mode is offline validation only: no credentials are read, no network is
// used, no file is modified. Network (--catalogs/--live) and local credentials
// (--pi) are explicit opt-ins. Reports are sanitized and never overwrite files.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TIMEOUTS = { metadataMs: 20000, inferenceMs: 60000, bodyLimitBytes: 2_000_000 };
export const BUDGET = 64; // max output tokens per live probe
export const PROMPT = "Reply only with OK.";
export const SUPPORTED_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"];
export const MAX_CONCURRENT_PROVIDERS = 3;

// Public catalog endpoints for advertised providers that have no local Pi
// configuration (evidence: 2026-11-16 investigation, /tmp/seekpeak-provider-audit-*).
export const PUBLIC_CATALOG_URLS = {
  seekai: "https://seekai.cc/api/pricing",
  venice: "https://api.venice.ai/api/v1/models?type=all",
  openrouter: "https://openrouter.ai/api/v1/models",
};

const QUOTA_PATTERN = /insufficient[_ ]?(?:quota|balance|credits?)|quota exceeded|out of credits|insufficient credit/i;
const RATE_PATTERN = /rate[_ ]?limit|too many requests/i;
const MAINTENANCE_PATTERN = /maintenance|维护|temporarily disabled/i;
const MODEL_PATTERN = /model|no available channel|no channel|模型|无可用渠道/i;
const AUTH_PATTERN = /invalid[_ ](?:api[_ ]?key|token)|unauthorized|authenticat|permission denied|forbidden|access denied|insufficient permissions?/i;
// Conservative fallback for non-text models when no catalog type is available.
// The catalog `type` field is the primary signal; this only bounds obvious cases.
const NON_TEXT_PATTERN = /\b(image|img|video|audio|speech|tts|whisper|embeddings?|rerank|imagine|midjourney|diffusion|flux|seedance|seedream|kling|ltx|veo|sora|wan|krea|muse|suno|music|inkling)\b/i;
const BLOCKING_STATUSES = new Set(["quota", "auth_or_permission", "rate_limited"]);
// Catalog type labels that mean a model accepts text chat; every other explicit
// type (image/audio/video/embedding/…) is display-only or non-chat.
const TEXT_CATALOG_TYPES = new Set(["text", "chat", "llm", "language"]);

// ---------- validation ----------

export function validateCredits(data) {
  const errors = [];
  const rootOk =
    data && typeof data === "object" && !Array.isArray(data) &&
    Object.keys(data).length === 1 && "offers" in data && Array.isArray(data.offers);
  if (!rootOk) return ["Root must be an object with an offers array"];
  if (data.offers.length === 0) return ["offers array must be nonempty"];

  const required = ["provider", "credits", "creditsShort", "url", "featured", "stars", "models"];
  const allowed = new Set([...required, "blurb", "note"]);
  const providers = new Set();
  const offerIds = new Set();
  const urls = new Set();

  data.offers.forEach((offer, index) => {
    let label = `offer ${index}`;
    if (!offer || typeof offer !== "object" || Array.isArray(offer)) {
      errors.push(`${label}: not an object`);
      return;
    }
    label = typeof offer.provider === "string" && offer.provider ? offer.provider : label;
    const missing = required.filter((field) => !(field in offer));
    if (missing.length) errors.push(`${label}: missing fields ${missing.sort().join(", ")}`);
    const unknown = Object.keys(offer).filter((field) => !allowed.has(field));
    if (unknown.length) errors.push(`${label}: unknown fields ${unknown.sort().join(", ")}`);

    for (const field of ["provider", "credits", "creditsShort", "url", "blurb", "note"]) {
      if (field in offer) {
        const value = offer[field];
        if (typeof value !== "string" || !value || value.trim() !== value || /[\x00-\x1f]/.test(value)) {
          errors.push(`${label}: invalid ${field}`);
        }
      }
    }

    const provider = offer.provider;
    if (typeof provider === "string") {
      const slug = offerSlug(provider);
      if (providers.has(provider.toLowerCase())) errors.push(`${label}: duplicate provider`);
      if (!slug || offerIds.has(slug)) errors.push(`${label}: invalid/duplicate generated offer id`);
      providers.add(provider.toLowerCase());
      offerIds.add(slug);
    }

    if (typeof offer.featured !== "boolean") errors.push(`${label}: featured must be a boolean`);
    if (!Number.isInteger(offer.stars) || offer.stars < 0 || offer.stars > 5) {
      errors.push(`${label}: stars must be an integer 0-5`);
    }

    const url = offer.url;
    if (typeof url === "string") {
      let parsed = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
        errors.push(`${label}: invalid HTTPS referral URL`);
      }
      if (urls.has(url)) errors.push(`${label}: duplicate URL`);
      urls.add(url);
    }

    const models = offer.models;
    if (!Array.isArray(models) || models.length === 0) {
      errors.push(`${label}: models must be a nonempty array`);
    } else {
      const seen = new Set();
      for (const model of models) {
        if (typeof model !== "string" || !model || model.trim() !== model || /[\x00-\x1f]/.test(model)) {
          errors.push(`${label}: invalid model value`);
        } else if (seen.has(model.toLowerCase())) {
          errors.push(`${label}: duplicate model ${model}`);
        } else {
          seen.add(model.toLowerCase());
        }
      }
    }

    const credits = offer.credits;
    const short = offer.creditsShort;
    if (typeof credits === "string" && typeof short === "string") {
      const norm = (value) => value.replace(/\s+credits?$/i, "").toLowerCase();
      if (norm(credits) !== norm(short)) errors.push(`${label}: inconsistent credits/creditsShort`);
      const dollar = credits.match(/^\$(\d+(?:\.\d{1,2})?)\s+Credits$/);
      const plain = credits.match(/^(\d+(?:,\d{3})*)\s+Credits$/);
      if (!dollar && !plain) {
        errors.push(`${label}: unexpected credit label`);
      } else {
        const value = Number(dollar ? dollar[1] : plain[1].replaceAll(",", ""));
        if (!(value > 0)) errors.push(`${label}: credit amount must be positive`);
      }
    }
  });
  return errors;
}

const offerSlug = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const normalizeName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");

function slugsMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na !== "" && na === nb;
}

// Loose fallback for offer names that embed the Pi provider key ("Vyceai.com"
// vs "vyceai"). Requires a long shared prefix so short names like "Acme" can
// never capture an unrelated provider such as "acmecloud".
function loosePrefixMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return (na.startsWith(nb) || nb.startsWith(na)) && Math.min(na.length, nb.length) >= 6;
}

// ---------- catalog normalization ----------

export function normalizeCatalog(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const rows = payload.data ?? payload.models;
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (typeof row === "string") {
      out.push({ id: row, name: row, type: undefined });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const id = row.id ?? row.model_name ?? row.model ?? row.name;
    if (id === undefined || id === null || id === "") continue;
    const spec = row.model_spec;
    const name = row.name ?? (spec && typeof spec === "object" ? spec.name : undefined) ?? String(id);
    out.push({ id: String(id), name: String(name), type: typeof row.type === "string" ? row.type : undefined });
  }
  return out;
}

// ---------- completion parsing (Chat Completions, Responses, Anthropic Messages) ----------

export function parseCompletion(body) {
  const out = { text: "", reasoning: "", error: "", code: "", finished: false, usage: {} };
  if (typeof body !== "string" || !body.trim()) return out;
  const events = [];
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // not JSON — fall through to SSE line parsing
    }
  }
  if (events.length === 0) {
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        // ignore junk lines
      }
    }
  }
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    absorbEvent(out, event);
  }
  return out;
}

function pickUsage(usage) {
  const picked = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens"]) {
    if (typeof usage[key] === "number") picked[key] = usage[key];
  }
  return picked;
}

function absorbResponseOutput(out, response) {
  if (response.status === "completed" || response.status === "incomplete") out.finished = true;
  if (!out.text && Array.isArray(response.output)) {
    for (const item of response.output) {
      for (const part of item?.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") out.text += part.text;
        if ((part?.type === "reasoning_text" || part?.type === "reasoning") && typeof part.text === "string") {
          out.reasoning += part.text;
        }
      }
    }
  }
  if (response.usage && typeof response.usage === "object") out.usage = pickUsage(response.usage);
}

function absorbEvent(out, event) {
  // Errors — any protocol, including inside HTTP 200 streams.
  let errorObj = null;
  if (event.error) errorObj = event.error;
  else if (event.type === "response.failed" && event.response?.error) errorObj = event.response.error;
  if (errorObj) {
    const message = typeof errorObj === "string" ? errorObj : errorObj.message ?? JSON.stringify(errorObj);
    if (!out.error) out.error = String(message ?? "");
    if (!out.code) {
      out.code = String(typeof errorObj === "object" ? errorObj.code ?? errorObj.type ?? "" : "");
    }
    return;
  }

  // OpenAI Chat Completions
  if (Array.isArray(event.choices)) {
    for (const choice of event.choices) {
      const message = choice.delta ?? choice.message ?? {};
      const content = message.content;
      if (typeof content === "string") out.text += content;
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") out.text += part.text;
        }
      }
      const thought = message.reasoning_content ?? message.reasoning;
      if (typeof thought === "string") out.reasoning += thought;
      if (choice.finish_reason) out.finished = true;
    }
    if (event.usage && typeof event.usage === "object") out.usage = pickUsage(event.usage);
    return;
  }

  // OpenAI Responses API (typed stream events and full response objects)
  if (typeof event.type === "string" && event.type.startsWith("response.")) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") out.text += event.delta;
    if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
      out.reasoning += event.delta;
    }
    absorbResponseOutput(out, event.response ?? event);
    return;
  }

  // Anthropic Messages
  if (event.type === "content_block_delta") {
    const delta = event.delta ?? {};
    if (delta.type === "text_delta" && typeof delta.text === "string") out.text += delta.text;
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") out.reasoning += delta.thinking;
    return;
  }
  if (event.type === "message_delta" && event.delta?.stop_reason) out.finished = true;
  if (event.type === "message_stop") out.finished = true;
  if (Array.isArray(event.content)) {
    for (const block of event.content) {
      if (block?.type === "text" && typeof block.text === "string") out.text += block.text;
      if (block?.type === "thinking" && typeof block.thinking === "string") out.reasoning += block.thinking;
    }
    if (typeof event.stop_reason === "string") out.finished = true;
    if (event.usage && typeof event.usage === "object") out.usage = pickUsage(event.usage);
    return;
  }

  // Untyped Responses-shaped JSON ({output, status}) and bare error messages.
  if (Array.isArray(event.output) || typeof event.status === "string") {
    absorbResponseOutput(out, event);
    return;
  }
  if (!out.error && !out.text && !out.reasoning && typeof event.message === "string") {
    out.error = event.message;
  }
}

// ---------- classification ----------

export function classifyResult(httpStatus, parsed = {}) {
  if (httpStatus === null || httpStatus === undefined) {
    return ["AbortError", "TimeoutError"].includes(parsed.code) ? "timeout" : "network_error";
  }
  if (httpStatus >= 300 && httpStatus < 400) return "redirected";
  const error = String(parsed.error ?? "").toLowerCase();
  const code = String(parsed.code ?? "").toLowerCase();
  // Body-carved error codes carry the authoritative quota/auth/rate signals
  // even when the human-readable message is generic.
  const blob = error && code ? `${error} ${code}` : error || code;
  const auth = httpStatus === 401 || httpStatus === 403 || AUTH_PATTERN.test(blob);
  const quota = httpStatus === 402 || QUOTA_PATTERN.test(blob);
  const rate = httpStatus === 429 || RATE_PATTERN.test(blob);
  const maintenance = MAINTENANCE_PATTERN.test(blob);
  // Model-missing errors are recognized by content both on 400/404 responses and
  // when embedded inside HTTP 200 streams; other statuses keep status priority.
  const modelMissing =
    (httpStatus === 400 || httpStatus === 404 || httpStatus === 200) && MODEL_PATTERN.test(blob);

  if (error || code) {
    // An error inside an HTTP 200 stream must never be classified as success.
    if (auth) return "auth_or_permission";
    if (quota) return "quota";
    if (rate) return "rate_limited";
    if (maintenance) return "maintenance";
    if (modelMissing) return "unavailable_model";
    if (httpStatus >= 500) return "upstream_error";
    return "provider_error";
  }
  if (httpStatus === 200) {
    // Only a protocol-level completion marker makes text a final answer;
    // partial or truncated output without one is inconclusive.
    if (String(parsed.text ?? "").trim() && parsed.finished) return "working";
    if (String(parsed.reasoning ?? "").trim()) return "reasoning_only";
    return "incomplete";
  }
  if (auth) return "auth_or_permission";
  if (quota) return "quota";
  if (rate) return "rate_limited";
  if (httpStatus >= 500) return "upstream_error";
  return "provider_error";
}

// ---------- secrets ----------

export function resolveSecret(value, env = process.env) {
  if (typeof value !== "string") return { value: "", reason: "credential value is not a string" };
  if (value.startsWith("!")) {
    return { value: "", reason: "credential command refused — not executed by this read-only audit" };
  }
  if (!value) return { value: "", reason: "credential value is empty" };
  const sentinel = "\0LITERAL_DOLLAR\0";
  const escaped = value.replaceAll("$$", sentinel);
  const names = [
    ...escaped.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g),
  ].map((match) => match[1] || match[2]);
  for (const name of names) {
    if (!env[name]) return { value: "", reason: `environment variable ${name} is not set` };
  }
  if (names.length) {
    const resolved = escaped
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, a, b) => env[a || b])
      .replaceAll(sentinel, "$");
    return { value: resolved, reason: `environment variable ${names.join(", ")}` };
  }
  return { value: escaped.replaceAll(sentinel, "$"), reason: "literal credential value" };
}

// ---------- args ----------

export function parseArgs(argv) {
  const options = {
    creditsPath: "credits.json",
    piDir: null,
    catalogs: false,
    live: false,
    reportPath: null,
    help: false,
  };
  const requireValue = (index, flag) => {
    if (index >= argv.length) throw new Error(`${flag} requires a value`);
    return argv[index];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
        options.help = true;
        break;
      case "--catalogs":
        options.catalogs = true;
        break;
      case "--live":
        options.live = true;
        break;
      case "--credits":
        options.creditsPath = requireValue(++i, arg);
        break;
      case "--report":
        options.reportPath = requireValue(++i, arg);
        break;
      case "--pi":
        if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) options.piDir = argv[++i];
        else options.piDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
        break;
      default:
        throw new Error(`unknown option: ${arg} (see --help)`);
    }
  }
  return options;
}

// ---------- sanitized HTTP layer ----------

function sanitize(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[REDACTED]");
  }
  out = out.replace(/bearer\s+\S+/gi, "Bearer [REDACTED]");
  out = out.replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]");
  // URL userinfo is credential material by definition — never report it.
  out = out.replace(/(https?:\/\/)([^@/\s]+)@/g, "$1[REDACTED]@");
  return out.slice(0, 400);
}

// Defense in depth: walk the assembled report and redact every string, so a
// field that forgets an explicit sanitize() cannot leak a secret into a file
// advertised as safe to share.
function sanitizeReport(value, secrets) {
  if (typeof value === "string") return sanitize(value, secrets);
  if (Array.isArray(value)) return value.map((item) => sanitizeReport(item, secrets));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = sanitizeReport(item, secrets);
    return out;
  }
  return value;
}

async function readBody(response, limit) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let truncated = false;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        const keep = value.subarray(0, Math.max(0, value.byteLength - (total - limit)));
        if (keep.length) chunks.push(keep);
        truncated = true;
        try {
          reader.cancel();
        } catch {
          // reader already closed
        }
        break;
      }
      chunks.push(value);
    }
    const parts = chunks.map((chunk) => decoder.decode(chunk, { stream: true }));
    parts.push(decoder.decode());
    return { text: parts.join(""), truncated };
  }
  const text = await response.text();
  return { text: text.slice(0, limit), truncated: text.length > limit };
}

async function request(url, { method = "GET", headers, body, timeoutMs, fetchImpl }) {
  const started = Date.now();
  const throwResult = (error) => ({
    kind: "throw",
    status: null,
    ms: Date.now() - started,
    text: "",
    truncated: false,
    errorName: error?.name ?? "Error",
    errorMessage: `${error?.name ?? "Error"}: ${error?.message ?? "request failed"}`,
  });
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual", // never follow redirects while carrying credentials
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return throwResult(error);
  }
  // Body consumption shares the error boundary: a stream that fails midway is
  // a per-request network finding, never an audit-aborting exception.
  try {
    const { text, truncated } = await readBody(response, TIMEOUTS.bodyLimitBytes);
    return { kind: "response", status: response.status, ms: Date.now() - started, text, truncated };
  } catch (error) {
    return throwResult(error);
  }
}

// ---------- protocol selection and request building ----------

export function selectProtocol(providerApi, modelId, modelOverride) {
  const api = modelOverride || providerApi;
  // Gateways that advertise Claude/DeepSeek models expose them through the
  // Chat Completions surface even when the local Pi config uses the Responses
  // API for GPT models (evidence: agentrouter-protocols.json, 2026-11-16).
  if (api === "openai-responses" && /^(claude|deepseek)/i.test(modelId)) return "openai-completions";
  return api;
}

function buildInference(protocol, baseUrl, model) {
  const base = String(baseUrl).replace(/\/+$/, "");
  if (protocol === "openai-responses") {
    return {
      url: `${base}/responses`,
      body: {
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: PROMPT }] }],
        stream: true,
        max_output_tokens: BUDGET,
        store: false,
        reasoning: { effort: "none" },
      },
    };
  }
  if (protocol === "openai-completions") {
    const body = {
      model,
      messages: [{ role: "user", content: PROMPT }],
      stream: true,
      max_tokens: BUDGET,
    };
    if (/^deepseek/i.test(model)) body.thinking = { type: "disabled" };
    return { url: `${base}/chat/completions`, body };
  }
  if (protocol === "anthropic-messages") {
    return {
      url: `${base}/messages`,
      body: { model, max_tokens: BUDGET, messages: [{ role: "user", content: PROMPT }], stream: true },
    };
  }
  return null;
}

function buildHeaders(protocol, key, configHeaders) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "SeekPeak-provider-audit/1.0",
  };
  if (key) {
    if (protocol === "anthropic-messages") {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${key}`;
    }
  }
  return { ...headers, ...configHeaders };
}

// ---------- audit orchestration ----------

function emptyModelEntry(model, sources) {
  return {
    model,
    sources,
    protocol: null,
    catalogMatch: null,
    status: "unverified",
    attempted: false,
    http: null,
    ms: null,
    textPreview: "",
    reasoningChars: 0,
    finished: false,
    usage: {},
    error: "",
    code: "",
    reason: "",
  };
}

export async function runAudit({
  creditsPath = "credits.json",
  piDir = null,
  catalogs = false,
  live = false,
  fetchImpl = fetch,
  env = process.env,
}) {
  const mode = { catalogs: Boolean(catalogs), live: Boolean(live), pi: piDir != null };
  const secrets = [];

  // 1. Load and validate credits.json — invalid input stops everything.
  let data = null;
  let parseError = "";
  try {
    data = JSON.parse(await readFile(creditsPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") throw error;
    parseError = String(error?.message ?? error);
  }
  const validationErrors = data === null
    ? [`credits.json could not be parsed as JSON: ${parseError}`]
    : validateCredits(data);
  const offers = data?.offers ?? [];
  const report = {
    tool: "audit-credits",
    checked_at: new Date().toISOString(),
    mode,
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors,
      offers: offers.length,
      advertisedModels: offers.reduce(
        (count, offer) => count + (Array.isArray(offer?.models) ? offer.models.length : 0),
        0,
      ),
    },
  };
  if (validationErrors.length) return report; // no credentials loaded, no requests made

  // 2. Local Pi configuration (only with --pi).
  const pi = { dir: piDir ?? "", present: false };
  const piProviders = {};
  const storedAuth = {};
  if (piDir != null) {
    try {
      const parsed = JSON.parse(await readFile(path.join(piDir, "models.json"), "utf8"));
      for (const [key, config] of Object.entries(parsed?.providers ?? {})) piProviders[key] = config;
      pi.present = true;
      pi.providers = Object.keys(piProviders).length;
      pi.configuredModels = Object.values(piProviders).reduce(
        (count, config) => count + (Array.isArray(config?.models) ? config.models.length : 0),
        0,
      );
    } catch (error) {
      pi.reason = error?.code === "ENOENT"
        ? `Pi directory not found or has no models.json: ${piDir}`
        : `Pi models.json could not be read: ${error?.message ?? error}`;
    }
    if (pi.present) {
      try {
        const auth = JSON.parse(await readFile(path.join(piDir, "auth.json"), "utf8"));
        for (const [name, value] of Object.entries(auth ?? {})) {
          const key = value && typeof value === "object" ? value.key ?? value.apiKey ?? value.access : undefined;
          if (key) storedAuth[name] = String(key);
        }
      } catch (error) {
        // auth.json is optional, but a malformed one must be explicit.
        if (error?.code !== "ENOENT") {
          pi.authError = `Pi auth.json could not be read: ${error?.message ?? error}`;
        }
      }
      pi.storedAuth = Object.keys(storedAuth);
    }
  } else {
    pi.reason = "Pi configuration not requested (run with --pi to include local models and credentials)";
  }
  for (const key of Object.values(storedAuth)) secrets.push(key);

  // 3. Build per-provider coverage: credits offers first, then Pi-only providers.
  const records = [];
  const byMatchKey = new Map();
  for (const offer of offers) {
    const record = {
      slug: offerSlug(offer.provider),
      name: offer.provider,
      matchKey: normalizeName(offer.provider),
      offer,
      piKey: null,
      piConfig: null,
      sources: ["credits"],
      models: new Map(),
    };
    records.push(record);
    byMatchKey.set(record.matchKey, record);
  }
  for (const [piKey, piConfig] of Object.entries(piProviders)) {
    // Bind a Pi provider to at most one offer, and an offer to at most one Pi
    // provider: exact normalized-name match first, then an unambiguous long
    // prefix. Ambiguities stay separate records — never a silent wrong binding.
    const exact = records.filter((record) => record.offer && slugsMatch(record.offer.provider, piKey));
    const candidates = exact.length ? exact : records.filter((record) => record.offer && loosePrefixMatch(record.offer.provider, piKey));
    const bindable = candidates.filter((record) => !record.piKey);
    if (candidates.length === 1 && bindable.length === 1) {
      const record = bindable[0];
      record.piKey = piKey;
      record.piConfig = piConfig;
      record.sources = ["credits", "pi"];
      continue;
    }
    if (!(Array.isArray(piConfig?.models) && piConfig.models.length > 0)) continue;
    const created = {
      slug: piKey,
      name: piKey,
      matchKey: normalizeName(piKey),
      offer: null,
      piKey: null,
      piConfig,
      sources: ["pi"],
      models: new Map(),
      matchNote:
        candidates.length > 1
          ? `ambiguous provider match: ${candidates.length} offers match '${piKey}' — audited separately`
          : candidates.length === 1
            ? `credits offer already bound to another Pi provider (${candidates[0].piKey}) — audited separately`
            : `no credits.json offer matches '${piKey}' — audited separately`,
    };
    records.push(created);
    byMatchKey.set(created.matchKey, created);
  }
  for (const record of records) {
    if (record.offer) {
      for (const model of record.offer.models) {
        // A bound offer's models are probed through the Pi configuration.
        record.models.set(model.toLowerCase(), emptyModelEntry(model, record.piConfig ? "credits+pi" : "credits"));
      }
    }
    if (record.piConfig) {
      for (const model of record.piConfig.models ?? []) {
        const id = String(model?.id ?? model ?? "");
        if (!id) continue;
        const existing = record.models.get(id.toLowerCase());
        if (existing) {
          existing.sources = "credits+pi";
          existing.piModel = model;
        } else {
          const entry = emptyModelEntry(id, "pi");
          entry.piModel = model;
          record.models.set(id.toLowerCase(), entry);
        }
      }
    }
  }

  const ctx = { fetchImpl, env, secrets, storedAuth, mode, pi };

  // 4. Audit each provider: at most three providers concurrently, models sequential.
  for (let start = 0; start < records.length; start += MAX_CONCURRENT_PROVIDERS) {
    await Promise.all(records.slice(start, start + MAX_CONCURRENT_PROVIDERS).map((record) => auditProvider(record, ctx)));
  }

  // 5. Summarize.
  const models = records.flatMap((record) => [...record.models.values()]);
  const byStatus = {};
  for (const entry of models) byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
  report.pi = pi;
  report.providers = records.map((record) => ({
    slug: record.slug,
    name: record.name,
    sources: record.sources,
    baseUrl: record.piConfig?.baseUrl ?? null,
    matchNote: record.matchNote ?? "",
    credential: record.credential ?? null,
    referral: record.referral ?? null,
    catalog: record.catalog ?? null,
    blocked: record.blocked ?? null,
    models: [...record.models.values()],
  }));
  report.summary = {
    providers: records.length,
    models: models.length,
    attempted: models.filter((entry) => entry.attempted).length,
    working: byStatus.working ?? 0,
    unavailable: (byStatus.unavailable_model ?? 0) + (byStatus.maintenance ?? 0),
    blocked: (byStatus.quota ?? 0) + (byStatus.auth_or_permission ?? 0) + (byStatus.rate_limited ?? 0),
    skipped: byStatus.skipped ?? 0,
    unverified: byStatus.unverified ?? 0,
    byStatus,
  };
  return sanitizeReport(report, secrets);
}

async function auditProvider(record, ctx) {
  const { fetchImpl, env, secrets, storedAuth, mode } = ctx;

  // Referral reachability (catalogs mode, no credentials).
  if (mode.catalogs && record.offer) {
    const result = await request(record.offer.url, { timeoutMs: TIMEOUTS.metadataMs, fetchImpl });
    record.referral = {
      url: record.offer.url,
      status: result.status,
      reachable: result.status !== null && result.status < 400,
      error: result.kind === "throw" ? sanitize(result.errorMessage, secrets) : "",
    };
  }

  // Current catalog (catalogs mode). Pi-configured providers may carry
  // credentials on their own catalog endpoint; public endpoints never do.
  let catalogEntries = null;
  if (mode.catalogs) {
    let catalogUrl = null;
    let credential = null;
    if (record.piConfig?.baseUrl) {
      catalogUrl = String(record.piConfig.baseUrl).replace(/\/+$/, "") + "/models";
      credential = resolveCredential(record, ctx);
      if (credential.value) secrets.push(credential.value);
    } else {
      for (const [key, url] of Object.entries(PUBLIC_CATALOG_URLS)) {
        if (slugsMatch(record.matchKey, key) || loosePrefixMatch(record.matchKey, key)) {
          catalogUrl = url;
          break;
        }
      }
    }
    if (catalogUrl) {
      const headers = { Accept: "application/json", "User-Agent": "SeekPeak-provider-audit/1.0" };
      if (credential?.value) headers.Authorization = `Bearer ${credential.value}`;
      const result = await request(catalogUrl, { timeoutMs: TIMEOUTS.metadataMs, fetchImpl, headers });
      const parsed = result.kind === "throw" ? null : safeJson(result.text);
      catalogEntries = parsed === null ? [] : normalizeCatalog(parsed);
      record.catalog = {
        url: catalogUrl,
        status: result.status,
        count: catalogEntries.length,
        truncated: result.truncated,
        // Never retain raw body excerpts: authenticated catalog responses must
        // not leak into reports even in redacted form.
        error: result.kind === "throw"
          ? sanitize(result.errorMessage, secrets)
          : parsed === null
            ? "non-JSON catalog response"
            : "",
      };
    }
  }
  const catalogIndex = new Map();
  if (catalogEntries) {
    for (const entry of catalogEntries) {
      catalogIndex.set(entry.id.toLowerCase(), entry);
      catalogIndex.set(entry.name.toLowerCase(), entry);
    }
  }

  // Credential resolution (live mode).
  let credential = null;
  if (mode.live) {
    credential = resolveCredential(record, ctx);
    if (credential.value) secrets.push(credential.value);
    record.credential = credential.value
      ? { present: true, source: credential.reason }
      : { present: false, reason: `no credentials: ${credential.reason}` };
  }

  if (!mode.live && !mode.catalogs) {
    for (const entry of record.models.values()) {
      entry.reason = "offline validation only — no checks requested";
    }
    return;
  }

  // Provider-wide block stops futile probes; skipped models stay explicit.
  let blocked = null;
  for (const entry of record.models.values()) {
    if (blocked) {
      entry.status = "skipped";
      entry.reason = `provider blocked after ${blocked.model} returned ${blocked.status}`;
      continue;
    }
    const catalogEntry = catalogEntries ? catalogIndex.get(entry.model.toLowerCase()) : undefined;
    entry.catalogMatch = catalogEntries ? Boolean(catalogEntry) : null;

    if (mode.live) {
      if (!credential.value) {
        entry.reason = `no credentials: ${credential.reason}`;
        continue;
      }
      if (!record.piConfig?.baseUrl) {
        entry.reason = "no credentials: provider is not configured in local Pi";
        continue;
      }
      const modelOverride = typeof entry.piModel === "object" && entry.piModel ? entry.piModel.api : undefined;
      const protocol = selectProtocol(record.piConfig.api, entry.model, modelOverride);
      entry.protocol = protocol;
      if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
        entry.reason = `unsupported protocol: ${protocol} — model left unverified`;
        continue;
      }
      const nonText = catalogEntry
        ? catalogEntry.type !== undefined
          ? !TEXT_CATALOG_TYPES.has(catalogEntry.type.toLowerCase())
          : NON_TEXT_PATTERN.test(entry.model)
        : NON_TEXT_PATTERN.test(entry.model);
      if (nonText) {
        entry.status = "catalog_only";
        entry.reason = catalogEntry?.type
          ? `catalog type '${catalogEntry.type}' is not a text model — no inference attempted`
          : "model name suggests a non-text model — no inference attempted";
        continue;
      }
      const built = buildInference(protocol, record.piConfig.baseUrl, entry.model);
      const headers = buildHeaders(protocol, credential.value, resolveConfigHeaders(record.piConfig, env, secrets));
      const result = await request(built.url, {
        method: "POST",
        headers,
        body: built.body,
        timeoutMs: TIMEOUTS.inferenceMs,
        fetchImpl,
      });
      entry.attempted = true;
      entry.http = result.status;
      entry.ms = result.ms;
      const parsed = result.kind === "throw"
        ? { text: "", reasoning: "", error: result.errorMessage, code: result.errorName }
        : parseCompletion(result.text);
      entry.status = classifyResult(result.status, parsed);
      entry.textPreview = sanitize(parsed.text.trim().slice(0, 80), secrets);
      entry.reasoningChars = parsed.reasoning.length;
      entry.finished = parsed.finished;
      entry.usage = parsed.usage;
      entry.error = sanitize(parsed.error, secrets);
      entry.code = sanitize(parsed.code, secrets);
      if (result.truncated) {
        entry.reason = `response truncated at ${TIMEOUTS.bodyLimitBytes} bytes`;
      }
      if (BLOCKING_STATUSES.has(entry.status)) {
        blocked = { model: entry.model, status: entry.status };
        record.blocked = blocked;
      }
    } else {
      // Catalogs-only mode: catalog presence is the only evidence collected.
      if (!catalogEntries) {
        entry.reason = "catalog not checked for this provider";
        continue;
      }
      if (catalogEntry) {
        entry.status = "catalog_only";
        entry.reason = "present in the provider's current catalog (no live inference requested)";
      } else {
        entry.reason = "not found in catalog (absence alone is not proof of unavailability)";
      }
    }
  }
}

function resolveCredential(record, { storedAuth, env }) {
  const stored = storedAuth[record.piKey] ?? storedAuth[record.piKey?.toLowerCase()];
  if (stored) return { value: stored, reason: "pi auth storage" };
  const configured = record.piConfig?.apiKey;
  if (configured === undefined || configured === null || configured === "") {
    return { value: "", reason: "Pi provider has no stored or configured API key" };
  }
  return resolveSecret(configured, env);
}

function resolveConfigHeaders(piConfig, env, secrets) {
  const resolved = {};
  for (const [name, value] of Object.entries(piConfig?.headers ?? {})) {
    const secret = resolveSecret(value, env);
    if (secret.value) {
      secrets.push(secret.value);
      resolved[name] = secret.value;
    }
  }
  return resolved;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- report writing ----------

export async function writeReport(reportPath, report) {
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  const payload = JSON.stringify(report, null, 2) + "\n";
  await writeFile(reportPath, payload, { flag: "wx", mode: 0o600 }); // exclusive: never overwrite
}

// ---------- CLI ----------

function printUsage() {
  console.log(`Usage: node scripts/audit-credits.mjs [options]

Read-only audit of the providers and models advertised in credits.json,
optionally against the current catalogs and live inference endpoints.

Options:
  --credits PATH   credits.json to audit (default: credits.json)
  --catalogs       check referral URLs and provider model catalogs (network)
  --pi [DIR]       include custom models and credentials from local Pi
                   (default dir: $PI_CODING_AGENT_DIR or ~/.pi/agent)
  --live           send minimal inference probes (needs --pi; paid API usage)
  --report PATH    write a sanitized JSON report to a NEW file (never overwrites)
  --help           show this help

Default (no flags): offline validation of credits.json only — no credentials,
no network, no file changes. Exit 0: audit completed. Exit 1: invalid credit
data. Exit 2: usage or I/O error.`);
}

function printSummary(report) {
  const validation = report.validation;
  console.log(
    `credits.json validation: ${validation.ok ? "PASS" : "FAIL"} ` +
      `(${validation.offers} offers, ${validation.advertisedModels} advertised models)`,
  );
  for (const error of validation.errors) console.log("  " + error);
  if (!validation.ok) return;
  const pi = report.pi ?? {};
  console.log(
    pi.present
      ? `Pi configuration: ${pi.dir} (${pi.providers} providers, ${pi.configuredModels} configured models)`
      : `Pi configuration: not used${pi.reason ? ` — ${pi.reason}` : ""}`,
  );
  for (const provider of report.providers ?? []) {
    const counts = {};
    for (const entry of provider.models) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    const parts = Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ");
    console.log(`${provider.name} [${provider.sources.join("+")}]: ${provider.models.length} models — ${parts || "none"}`);
    for (const entry of provider.models) {
      if (entry.status === "working") continue;
      const detail = [
        entry.http === null ? "" : `HTTP ${entry.http}`,
        entry.error || entry.reason,
      ].filter(Boolean).join(" — ");
      console.log(`    ${entry.attempted ? "✗" : "·"} ${entry.model}: ${entry.status}${detail ? " (" + detail + ")" : ""}`);
    }
  }
  const summary = report.summary;
  console.log(
    `Coverage: ${summary.models} models — ${summary.attempted} attempted, ` +
      `${summary.working} working, ${summary.unavailable} unavailable/maintenance, ` +
      `${summary.blocked} blocked, ${summary.skipped} skipped, ${summary.unverified} unverified`,
  );
}

export async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(String(error?.message ?? error));
    return 2;
  }
  if (options.help) {
    printUsage();
    return 0;
  }
  if (options.live && options.piDir == null) {
    console.error("--live requires --pi: live probes need local credentials");
    return 2;
  }
  let report;
  try {
    report = await runAudit({
      creditsPath: options.creditsPath,
      piDir: options.piDir,
      catalogs: options.catalogs,
      live: options.live,
    });
  } catch (error) {
    console.error("audit failed: " + sanitize(String(error?.message ?? error), []));
    return 2;
  }
  printSummary(report);
  if (options.reportPath) {
    try {
      await writeReport(options.reportPath, report);
      console.log(`Report written: ${options.reportPath}`);
    } catch (error) {
      console.error(`could not write report ${options.reportPath}: ${error?.message ?? error}`);
      return 2;
    }
  }
  return report.validation.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
