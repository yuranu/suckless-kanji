# Agent rules

## Commits

- Commit and push as work progresses: one commit per coherent step (a fix, a
  feature, a data change), not one large commit at the end of a task.
- Sign off every commit (`git commit -s`).
- Message format:
  - Subject: one line, brief, soft limit 60 characters, hard limit 80.
  - Blank line, then a body in Markdown explaining what and why.
  - Wrap the body at 80 columns, except where wrapping would make it ugly
    (tables, long URLs, code).
- Work on `master` (not `main`) and push to `origin`
  (`git@github.com:yuranu/suckless-kanji.git`) after committing.

## Generated files

- `data/curriculum.yaml` and `web/data/kanji.js` are generated. Never edit them
  by hand: change the scripts in `scripts/` and rebuild (`npm run build`).
- Commit the regenerated output together with the script change that caused it.
- `raw/` (downloads) and `node_modules/` are reproducible and not committed.
