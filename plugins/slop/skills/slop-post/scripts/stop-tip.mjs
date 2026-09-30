#!/usr/bin/env node
// Stop hook: at most once per session, once the session has made a git
// commit, print a one-line tip to run /slop-post. It never posts, never calls
// the network, and exits quietly on anything unexpected (a hook must not get
// in the way of the session). Opt out with SLOP_POST_TIP=0.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstTimestamp, gitCommitsInWindow } from "./receipt-lib.mjs";

async function readStdin() {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

function tipText(commitCount) {
  return `Slop: this session made ${commitCount} commit${commitCount === 1 ? "" : "s"}. Run /slop-post to turn it into a private draft with a Build Receipt; nothing goes public until you publish it.`;
}

async function main() {
  if (process.env.SLOP_POST_TIP === "0") return;
  const input = JSON.parse((await readStdin()) || "{}");
  if (input.stop_hook_active) return;
  const sessionId = String(input.session_id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!sessionId || !input.transcript_path || !input.cwd) return;

  const dir = process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), "slop-claude-code-plugin");
  const marker = join(dir, `tip-shown-${sessionId}`);
  if (existsSync(marker)) return;

  const start = firstTimestamp(input.transcript_path);
  if (start === null) return;
  const commits = gitCommitsInWindow(input.cwd, start, Date.now());
  if (commits.length === 0) return;

  mkdirSync(dir, { recursive: true });
  writeFileSync(marker, new Date().toISOString());
  // systemMessage: shown to the user, not fed to the model.
  process.stdout.write(JSON.stringify({ systemMessage: tipText(commits.length) }) + "\n");
}

main().catch(() => {
  // silent by design
}).finally(() => process.exit(0));
