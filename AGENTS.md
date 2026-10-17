# Working on performance.md

This repo holds the PERFORMANCE.md format (`spec.md`) and `performance-md`, the CLI that implements it.

## Rules

- **`spec.md` is the source of truth.** Where the code and the spec disagree, fix the code. If the spec looks wrong or leaves a question open, stop and ask; never change it silently. A change to the spec is its own decision, stated in the PR.
- **Never merge your own PR.** A maintainer reviews and merges.
- **Short PR descriptions, outcome first:** what works now, how it was proven, then any open question for the reviewer.
- **A green `npm test` is required** for every PR.

## Commands

| Command | What |
|---------|------|
| `npm ci` | Install from a fresh clone |
| `npm test` | All tests (`node:test`, files in `test/*.test.mjs`) |
| `node bin/performance-md.mjs lint [--strict] [--all] [--file <path>]` | Check a PERFORMANCE.md against the spec |
| `node bin/performance-md.mjs check`, `changed`, `measure`, `compare` | The other commands of the spec's Commands table |
| `npm install --no-save lighthouse@12.6.1` | Before running `measure` by hand; it uses the installed Chrome, or the one `CHROME_PATH` names |

## How the code is built

- Plain ES modules (`.mjs`), Node ≥ 22, **no build step**: projects install the CLI as a git dependency pinned by commit, so what's in the repo is what runs.
- Runtime dependencies stay minimal: `yaml`, and `parse5` for HTML. Lighthouse and `chrome-launcher` are optional and loaded only by `measure`, so `lint`, `check`, `changed` and `compare` never install a browser.
- The spec's names live in one place: `src/spec.mjs` (metrics, stats, artifact types, tools, defaults) and `schema.json` (the front matter's shape). A new metric, budget, rule or field goes into the spec first, then both of these, then the code.
- `lint` = `schema.json` (checked by the small validator in `src/schema.mjs`, which refuses keywords it doesn't implement) + the checks a schema can't express, in `src/lint.mjs`.
- Exit codes are the spec's: 1 for a failed check; 2 for a usage error, so a typo can't pass for a broken budget.
- Tests use fixtures in `test/fixtures/` (a tiny static site; recorded results for `compare`). Lighthouse never runs in tests: the code around it is tested with a fake runner. The spec's own example must always lint clean (`test/lint.test.mjs` reads it from `spec.md`).
