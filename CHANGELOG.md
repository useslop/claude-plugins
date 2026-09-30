# Changelog

## slop 0.2.0

- `/slop:slop-post --challenge` enters this week's Slop challenge. The plugin looks up the current challenge (`GET https://useslop.com/api/v1/challenge/current`, a read-only request that sends nothing about your session), shows you the week's prompt and proof, writes the post to answer the prompt, and sends the week's tag as `challenge_tag` with the draft.
- If Slop has no challenge open for entries (or can't be reached), the plugin says "Challenge entry isn't available yet on Slop, so this will be a normal draft." and carries on with a normal draft.
- After saving, the plugin tells you whether Slop confirmed the entry. If Slop didn't echo the tag back, the draft is saved but is not entered in the challenge. If Slop refuses the tag, you see its error.
- `--challenge` works with `--dry-run`, which shows exactly what would be sent, including `challenge_tag`, and sends nothing.
- New script `slop-challenge.mjs`; `slop-draft.mjs` takes `--challenge-tag <tag>` (1 to 40 lowercase letters, digits or dashes).

## slop 0.1.0

- First release: `/slop:slop-post` turns a Claude Code session into a private 48-hour Slop draft with an automatic Build Receipt (model, tools, run time, commits), published by you from a claim link.
