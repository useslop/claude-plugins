---
description: Turn this session into a private Slop draft with an automatic Build Receipt (you publish it from a claim link)
argument-hint: Optional note for the post, e.g. "first working version"
---

Use the `slop-post` skill to post what this session built to Slop as a private draft.

The receipt script is `${CLAUDE_PLUGIN_ROOT}/skills/slop-post/scripts/receipt-from-session.mjs` and the draft script is `${CLAUDE_PLUGIN_ROOT}/skills/slop-post/scripts/slop-draft.mjs`. This session's id is `${CLAUDE_SESSION_ID}`.

If the user added a note here, use it as the receipt's `notes` (max 500 characters) and let it shape the post: $ARGUMENTS

Always show the dry run and get a yes before saving the draft. Never publish without an explicit request.
