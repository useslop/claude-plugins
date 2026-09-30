---
name: slop-post
description: Post what this Claude Code session built to Slop (useslop.com) as a private draft with an automatic Build Receipt (model, tools, run time, commits). Use when the user runs /slop-post or asks to share, post or ship this session's work to Slop. Saves a draft only; the human publishes it from the claim link.
---

# Post this session to Slop

You turn the current session into a **private Slop draft** carrying a Build Receipt. Nothing becomes public: Slop keeps the draft for 48 hours and your human publishes it, as their own post, from a claim link. The scripts below sit in `scripts/` inside this skill's base directory (Claude Code prints that directory when it loads the skill); call them with `node`.

## 1. Build the receipt (local only)

Run, from the session's working directory:

```
node <skill dir>/scripts/receipt-from-session.mjs --session "${CLAUDE_SESSION_ID}" --cwd "$PWD" --explain
```

It reads this session's transcript and `git log` on this machine and prints the receipt JSON: `model` (the model that did most of the work), `tools` (the tools actually used, most used first, max 20), `session_minutes` (first to last transcript timestamp, whole minutes), `commit_range` (commits made during the session, short SHAs), and an empty `notes`. It ignores this posting step itself (everything from `/slop-post` or this skill loading onward). If it can't find the transcript, run it again without `--session` (it falls back to the newest session for this directory). Don't edit `model`, `tools`, `session_minutes` or `commit_range`: they are the evidence. Never add a `client` key; Slop sets that itself.

## 2. Write the post

From what happened in this session, draft:

- `content`: first line is the title (what was built, plain words, under 80 characters); then 2 to 5 short lines on what it does and one honest line on how it was built. Max 2000 characters.
- `post_type`: `build` (or `launch`, `tutorial`, `thought` if that fits better).
- `demo_url`: only a public `https://` link the session actually produced or used. Leave it out otherwise.
- `notes` in the receipt: one line the human would sign, max 500 characters, or leave it empty for them.

Keep private things out: no secrets, tokens, internal hostnames, customer names, file paths under the home directory, or text copied from the transcript. The receipt fields and this post are the only things that leave the machine.

Write it to a temporary file, e.g. `/tmp/slop-post-<random>.json`:

```json
{ "content": "...", "post_type": "build", "build_receipt": { "model": "...", "tools": ["..."], "session_minutes": 12, "commit_range": "abc1234..def5678", "notes": "" } }
```

## 3. Show the human, then send

Run the dry run and show the human the post text and receipt it prints:

```
node <skill dir>/scripts/slop-draft.mjs --post /tmp/slop-post-<random>.json --dry-run
```

Ask: "Save this as a private Slop draft?" Send only after a yes (edit the file first if they ask for changes):

```
node <skill dir>/scripts/slop-draft.mjs --post /tmp/slop-post-<random>.json
```

Give the human the claim link it prints, say it expires in 48 hours, and that the post goes public only when they press publish there. Then delete the temporary file.

## Rules

- Default is the key-less draft. Use `--publish` (which posts immediately with `SLOP_API_KEY`) only if the human explicitly asks to publish right now after seeing the final text, and a `slop_` key is already in the environment. Never ask them to paste a key into the chat.
- If a Slop MCP server is already connected in this session (a `create_post` tool from useslop.com), you may call that tool with the same `content`, `post_type` and `build_receipt` instead of step 3's script, after the same yes. Slop then records the post as made via Claude Code. If that server has a key configured, the post is published at once, so treat it like `--publish`.
- If Slop answers with an error (rate limit: 10 drafts per hour per network; content rules), tell the human what it said. Don't retry in a loop.
