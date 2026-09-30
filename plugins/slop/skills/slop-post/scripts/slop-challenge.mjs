#!/usr/bin/env node
// Look up this week's Slop challenge for `/slop-post --challenge`:
// GET <origin>/api/v1/challenge/current (read-only, no key, nothing about the session is sent).
//
//   node slop-challenge.mjs
//
// Open for entries: prints the title, prompt, proof and tag, then one JSON line
// ({"available":true,"tag":...}) the agent can use; pass the tag to
// `slop-draft.mjs --challenge-tag <tag>`. Anything else (endpoint not there yet,
// not accepting entries, upcoming, network trouble, an odd answer) prints exactly
// the UNAVAILABLE line and exits 0: the post goes on as a normal draft.
// The origin follows SLOP_MCP_URL (default https://useslop.com).

import { CHALLENGE_TAG_RE, DEFAULT_ENDPOINT, PLUGIN_VERSION, isMainModule } from "./slop-draft.mjs";

export const UNAVAILABLE = "Challenge entry isn't available yet on Slop, so this will be a normal draft.";
const TIMEOUT_MS = 5_000;
const MAX_TEXT = 500;

export function challengeUrl(env = process.env) {
  return new URL("/api/v1/challenge/current", new URL(env.SLOP_MCP_URL || DEFAULT_ENDPOINT).origin).href;
}

// Server text goes to a terminal and into the agent's context: one line, no control characters, capped.
function clean(v) {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim().slice(0, MAX_TEXT) : "";
}

export function parseChallenge(body) {
  const d = body?.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return { available: false, reason: "no data object" };
  if (d.accepts_entries !== true) return { available: false, reason: "not accepting entries" };
  if (d.upcoming === true) return { available: false, reason: "upcoming" };
  if (typeof d.tag !== "string" || !CHALLENGE_TAG_RE.test(d.tag)) return { available: false, reason: "bad tag" };
  const title = clean(d.title);
  const prompt = clean(d.prompt);
  if (!title || !prompt) return { available: false, reason: "no title or prompt" };
  const c = { available: true, tag: d.tag, title, prompt, proof: clean(d.proof) };
  if (Number.isInteger(d.week)) c.week = d.week;
  for (const k of ["key", "badge", "starts_on", "ends_on"]) if (clean(d[k])) c[k] = clean(d[k]);
  if (typeof d.url === "string" && /^https:\/\/\S+$/.test(d.url)) c.url = clean(d.url);
  return c;
}

// Never throws: every failure is { available: false, reason }.
export async function fetchChallenge({ env = process.env, fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let url;
  try {
    url = challengeUrl(env);
  } catch {
    return { available: false, reason: "SLOP_MCP_URL is not a URL" };
  }
  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": `slop-claude-code-plugin/${PLUGIN_VERSION} (node ${process.version})` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200) return { available: false, reason: `HTTP ${res.status}` };
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { available: false, reason: "not JSON" };
    }
    return parseChallenge(body);
  } catch (err) {
    return { available: false, reason: `network: ${err?.name ?? "error"}` };
  }
}

export function formatChallenge(c) {
  const when = [c.week ? `week ${c.week}` : "", c.starts_on && c.ends_on ? `${c.starts_on} to ${c.ends_on}` : ""].filter(Boolean).join(", ");
  const lines = [`This week's Slop challenge: ${c.title}${when ? ` (${when})` : ""}`, `Prompt: ${c.prompt}`];
  if (c.proof) lines.push(`Proof: ${c.proof}`);
  lines.push(`Tag: ${c.tag} (send it with --challenge-tag ${c.tag})`);
  if (c.url) lines.push(`Details: ${c.url}`);
  return lines.join("\n");
}

async function main() {
  const extra = process.argv.slice(2);
  if (extra.length) {
    console.error("usage: slop-challenge.mjs (no arguments; the origin follows SLOP_MCP_URL)");
    return extra.every((a) => a === "--help" || a === "-h") ? 0 : 1;
  }
  const c = await fetchChallenge();
  if (!c.available) {
    console.log(UNAVAILABLE);
    return 0;
  }
  console.log(formatChallenge(c));
  console.log(JSON.stringify(c));
  return 0;
}

if (isMainModule(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    () => {
      // Never let a challenge lookup break posting.
      console.log(UNAVAILABLE);
      process.exit(0);
    }
  );
}
