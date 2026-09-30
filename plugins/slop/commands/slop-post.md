---
description: Turn this session into a private Slop draft with an automatic Build Receipt (you publish it from a claim link)
argument-hint: Optional note, plus --challenge to enter this week's Slop challenge and/or --dry-run to only preview
---

Use the `slop-post` skill to post what this session built to Slop as a private draft.

The receipt script is `${CLAUDE_PLUGIN_ROOT}/skills/slop-post/scripts/receipt-from-session.mjs`, the draft script is `${CLAUDE_PLUGIN_ROOT}/skills/slop-post/scripts/slop-draft.mjs` and the challenge script is `${CLAUDE_PLUGIN_ROOT}/skills/slop-post/scripts/slop-challenge.mjs`. This session's id is `${CLAUDE_SESSION_ID}`.

The user's arguments: $ARGUMENTS

- `--challenge`: enter this week's Slop challenge. Follow the skill's challenge step: run the challenge script first; if it's open, show the human its prompt and proof, write the post so it answers the prompt, and pass its tag with `--challenge-tag <tag>`; if it prints "Challenge entry isn't available yet on Slop, so this will be a normal draft.", say that line and carry on with a normal draft.
- `--dry-run`: stop after showing the dry run (with `--challenge`, it includes the `challenge_tag`). Send nothing.
- Any other text is a note: use it as the receipt's `notes` (max 500 characters) and let it shape the post.

Always show the dry run and get a yes before saving the draft. Never publish without an explicit request.
