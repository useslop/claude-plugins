#!/usr/bin/env node
// Send a post and its Build Receipt to Slop's MCP `create_post` and print the
// claim link. Default is a KEY-LESS call, which Slop saves as a private
// 48-hour draft: nothing is public until a signed-in human opens the link and
// publishes it as their own post.
//
//   node slop-draft.mjs --post post.json --dry-run   show exactly what would be sent
//   node slop-draft.mjs --post post.json             save the private draft
//   node slop-draft.mjs --post post.json --publish   publish NOW with $SLOP_API_KEY
//                                                    (only after the human said so)
//   ... --challenge-tag model-drop                   also enter this week's Slop challenge
//                                                    (tag from slop-challenge.mjs); Slop echoes
//                                                    challenge_tag when it accepted the entry
//
// post.json: { content, post_type?, demo_url?, code_snippet?, code_language?, build_receipt? }
// Only those fields are sent. There is deliberately no prompt field: the
// plugin never sends prompts or transcript text.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateBuildReceipt } from "./receipt-lib.mjs";

export const PLUGIN_VERSION = "0.2.0";
export const DEFAULT_ENDPOINT = "https://useslop.com/api/mcp";
const POST_FIELDS = new Set(["content", "post_type", "demo_url", "code_snippet", "code_language", "build_receipt"]);
const POST_TYPES = new Set(["thought", "build", "review", "question", "tutorial", "launch"]);
// Slop's own caps (POST /api/v1/posts, lib/post-drafts).
const MAX_CONTENT = 2000;
const MAX_CODE = 8000;
const MAX_CODE_LANGUAGE = 30;
const MAX_DEMO_URL = 500;
// Weekly challenge tags (GET /api/v1/challenge/current -> data.tag).
export const CHALLENGE_TAG_RE = /^[a-z0-9-]{1,40}$/;

export function validateChallengeTag(tag) {
  if (typeof tag !== "string" || !CHALLENGE_TAG_RE.test(tag)) {
    return { ok: false, error: `--challenge-tag must be 1 to 40 lowercase letters, digits or dashes (got ${JSON.stringify(String(tag ?? "")).slice(0, 60)})` };
  }
  return { ok: true, tag };
}

export function validatePost(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "post must be a JSON object" };
  const junk = Object.keys(raw).filter((k) => !POST_FIELDS.has(k));
  if (junk.length) return { ok: false, error: `unsupported field(s): ${junk.join(", ")} (allowed: ${[...POST_FIELDS].join(", ")})` };
  const args = {};
  if (typeof raw.content !== "string" || !raw.content.trim()) return { ok: false, error: "content is required" };
  if (raw.content.length > MAX_CONTENT) return { ok: false, error: `content is over ${MAX_CONTENT} characters (${raw.content.length})` };
  args.content = raw.content;
  const type = raw.post_type ?? "build";
  if (!POST_TYPES.has(type)) return { ok: false, error: `post_type must be one of ${[...POST_TYPES].join(", ")}` };
  args.post_type = type;
  if (raw.demo_url !== undefined && raw.demo_url !== "") {
    if (typeof raw.demo_url !== "string" || raw.demo_url.length > MAX_DEMO_URL || !/^https:\/\/\S+$/.test(raw.demo_url)) {
      return { ok: false, error: "demo_url must be an https:// link" };
    }
    args.demo_url = raw.demo_url;
  }
  if (raw.code_snippet !== undefined && raw.code_snippet !== "") {
    if (typeof raw.code_snippet !== "string" || raw.code_snippet.length > MAX_CODE) return { ok: false, error: `code_snippet must be at most ${MAX_CODE} characters` };
    args.code_snippet = raw.code_snippet;
    if (raw.code_language !== undefined && raw.code_language !== "") {
      if (typeof raw.code_language !== "string" || raw.code_language.length > MAX_CODE_LANGUAGE) return { ok: false, error: `code_language must be at most ${MAX_CODE_LANGUAGE} characters` };
      args.code_language = raw.code_language;
    }
  }
  if (raw.build_receipt !== undefined) {
    const v = validateBuildReceipt(raw.build_receipt);
    if (!v.ok) return { ok: false, error: v.error };
    args.build_receipt = v.receipt; // trimmed; empty notes dropped
  }
  return { ok: true, args };
}

export function buildRequest(args, { publish = false, env = process.env } = {}) {
  const endpoint = env.SLOP_MCP_URL || DEFAULT_ENDPOINT;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    // Honest identity. The "via Claude Code" chip is Slop's call, made from
    // what it sees on the request; this script never borrows Claude Code's UA.
    "user-agent": `slop-claude-code-plugin/${PLUGIN_VERSION} (node ${process.version})`,
  };
  if (publish) {
    const key = env.SLOP_API_KEY;
    if (!key || !key.startsWith("slop_")) throw new Error("--publish needs SLOP_API_KEY (a slop_ key with \"can post\") in the environment");
    headers.authorization = `Bearer ${key}`;
  }
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_post", arguments: args } };
  return { endpoint, headers, body };
}

// Streamable HTTP servers may answer as JSON or as an SSE stream.
export function parseRpcResponse(text, contentType = "") {
  if (contentType.includes("text/event-stream")) {
    const datas = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    for (let i = datas.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(datas[i]);
        if (j && (j.result || j.error)) return j;
      } catch {
        // next
      }
    }
    throw new Error("no JSON-RPC message in the event stream");
  }
  return JSON.parse(text);
}

// The challenge_tag Slop echoes when it accepted the entry; null means it ignored the tag.
export function challengeEcho(result, text = "") {
  const sc = result?.structuredContent ?? {};
  const tag = sc.challenge_tag ?? sc.data?.challenge_tag ?? (/"challenge_tag"\s*:\s*"([a-z0-9-]{1,40})"/.exec(text) ?? [])[1];
  return typeof tag === "string" && CHALLENGE_TAG_RE.test(tag) ? tag : null;
}

export function challengeLine(kind, challenge) {
  if (challenge.entered) {
    return kind === "draft"
      ? `Challenge: Slop accepted the tag "${challenge.tag}". The post enters this week's challenge when you publish it.`
      : `Challenge: Slop accepted the tag "${challenge.tag}". This post is entered in this week's challenge.`;
  }
  return `Challenge: the ${kind === "draft" ? "draft was saved" : "post was published"}, but it is NOT entered in the challenge (Slop didn't confirm the "${challenge.tag}" tag).`;
}

export function summarizeResult(rpc) {
  if (rpc.error) return { ok: false, error: `${rpc.error.message ?? "JSON-RPC error"}${rpc.error.code ? ` (${rpc.error.code})` : ""}` };
  const r = rpc.result ?? {};
  const text = (Array.isArray(r.content) ? r.content : []).filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  if (r.isError) return { ok: false, error: text || "create_post failed" };
  const sc = r.structuredContent ?? {};
  const echo = challengeEcho(r, text);
  const extra = echo ? { challengeTag: echo } : {};
  const claimUrl = sc.claim_url ?? (/https:\/\/useslop\.com\/claim\/[A-Za-z0-9_-]{43}[^\s)]*/.exec(text) ?? [])[0];
  if (claimUrl) return { ok: true, kind: "draft", claimUrl, expiresAt: sc.expires_at ?? null, text, ...extra };
  const url = sc.url ?? sc.data?.url ?? (/https:\/\/useslop\.com\/post\/[^\s)]+/.exec(text) ?? [])[0];
  return { ok: true, kind: "published", url: url ?? null, text, ...extra };
}

function parseArgs(argv) {
  const out = { dryRun: false, publish: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--post") out.post = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--publish") out.publish = true;
    else if (a === "--json") out.json = true;
    else if (a === "--challenge-tag") {
      out.challengeTag = argv[++i];
      // Never swallow the next flag (e.g. --dry-run) as the tag.
      if (out.challengeTag === undefined || out.challengeTag.startsWith("-")) throw new Error("--challenge-tag needs a tag, e.g. --challenge-tag model-drop");
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.post) throw new Error("usage: slop-draft.mjs --post <post.json|-> [--dry-run] [--publish] [--json] [--challenge-tag <tag>]");
  return out;
}

async function readStdin() {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(opts.post === "-" ? await readStdin() : readFileSync(opts.post, "utf8"));
  const v = validatePost(raw);
  if (!v.ok) {
    console.error(`Not sent: ${v.error}`);
    return 1;
  }
  const args = { ...v.args };
  if (opts.challengeTag !== undefined) {
    const t = validateChallengeTag(opts.challengeTag);
    if (!t.ok) {
      console.error(`Not sent: ${t.error}`);
      return 1;
    }
    args.challenge_tag = t.tag; // sent only when asked for
  }
  const req = buildRequest(args, { publish: opts.publish });

  if (opts.dryRun) {
    const shown = { ...req.headers };
    if (shown.authorization) shown.authorization = "Bearer slop_…(redacted)";
    console.log(JSON.stringify({ mode: opts.publish ? "publish now (with key)" : "private draft (no key)", endpoint: req.endpoint, headers: shown, body: req.body }, null, 2));
    return 0;
  }

  const res = await fetch(req.endpoint, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let rpc;
  try {
    rpc = parseRpcResponse(text, res.headers.get("content-type") ?? "");
  } catch {
    console.error(`Slop answered HTTP ${res.status} with something that isn't JSON-RPC: ${text.slice(0, 300)}`);
    return 1;
  }
  const out = summarizeResult(rpc);
  const challenge = args.challenge_tag && out.ok ? { tag: args.challenge_tag, entered: out.challengeTag === args.challenge_tag } : null;
  if (opts.json) console.log(JSON.stringify(challenge ? { ...out, challenge } : out, null, 2));
  if (!out.ok) {
    if (!opts.json) console.error(`Slop said no: ${out.error}`);
    return 1;
  }
  if (!opts.json) {
    if (out.kind === "draft") {
      console.log(`Saved as a private draft (not public). Open this link, sign in, check it and publish:\n${out.claimUrl}`);
      if (out.expiresAt) console.log(`The link expires ${out.expiresAt}.`);
    } else {
      console.log(`Published: ${out.url ?? "(no url returned)"}`);
    }
    if (challenge) console.log(challengeLine(out.kind, challenge));
  }
  return 0;
}

// Run only when executed directly (the tests import this file). Compare real paths: through a
// symlink (macOS /tmp -> /private/tmp) import.meta.url and argv[1] differ for the same file.
export function isMainModule(metaUrl = import.meta.url) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  );
}
