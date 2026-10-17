# performance.md

[![CI](https://github.com/chtitoon/performance.md/actions/workflows/validate-cli.yml/badge.svg?branch=main)](https://github.com/chtitoon/performance.md/actions/workflows/validate-cli.yml)
[![Format 1.0 alpha](https://img.shields.io/badge/format-1.0%20alpha-orange)](spec.md)
[![Node ≥ 22](https://img.shields.io/badge/node-%E2%89%A5%2022-339933)](package.json)
[![License MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A plain-text format for performance budgets, and a small CLI that checks and compares against it. A `PERFORMANCE.md` file holds the rules in its YAML front matter and the reasons in its prose, like [DESIGN.md](https://github.com/google-labs-code/design.md) does for design.

```markdown
---
version: "1.0"
artifact:
  type: static-site
  dist: dist
  origin: https://example.com
  budgets: { total: 90 KB, js: 0 B }
  rules: { origins: [self], image_dimensions: true }
measure:
  tool: lighthouse
  noise: 2%
  metrics:
    - { metric: lcp, stat: median, limit: 1.5 s, delta: 50 ms }
    - { metric: cls, stat: worst,  limit: 0.1,   delta: 0.01 }
---

# Performance

**No JavaScript.** Script is the main cause of blocking time and of most tracking. A page that
needs some raises its own `js` budget, with the reason in the pull request.

**CLS takes its worst run.** A web font racing the first paint makes the shift appear on some
loads only; a median of a coin flip is noise, and the shift still happens to real visitors.
```

```console
$ npx performance-md check
Budgets and rules OK across 4 pages (largest 77.6 KB)

$ npx performance-md compare results
❌ Failed.

Lighthouse mobile, 5 runs per side, base → head, median unless noted.

/
  🔴 LCP 1.20 s → 1.35 s
  same: CLS (worst) 0.000

❌ past a limit · 🔴 worse than base by more than delta and noise; see measure.metrics in PERFORMANCE.md
```

Status: alpha. The format is in [spec.md](spec.md). MIT licensed.

## Why not Lighthouse CI or size-limit

- **Rules and reasons in one file.** A `lighthouserc` or `.size-limit.json` holds numbers; why they are what they are lives somewhere else, if anywhere. Here the reason sits under the rule, where the next person, or agent, about to break it will read it.
- **Noise-aware comparison against the base.** Absolute limits catch a bad page; comparison catches drift, ten small changes that each add 50 ms. `compare` fails only when a metric got worse than the base by more than both its `delta` and the measurement's `noise`, so a noisy run neither fails a PR nor earns it praise. Lighthouse CI asserts against fixed thresholds, and its build diffs need the LHCI server.
- **Budgets with no browser.** `check` reads the built site and adds up what each page downloads: HTML, CSS, scripts, images, and only the fonts its text uses. It's fast and deterministic enough for a deploy gate. size-limit sizes the files you list; it doesn't know what each page loads.
- **Not only for the web.** Lighthouse CI and size-limit are web tools. A `PERFORMANCE.md` describes any surface: a website, an API, an app. Version 1.0 defines static sites and Lighthouse; `latency` and `error_rate` are already defined, and `tool: command` (any command that writes results) is reserved, so APIs and apps fit later without a breaking change.

## Quickstart

Install the CLI from a commit (it isn't on npm yet):

```sh
npm install --save-dev "github:chtitoon/performance.md#<commit>"
```

Write `PERFORMANCE.md` next to the site's `package.json` (the example above, or the complete one at the end of [spec.md](spec.md)), then:

```sh
npx performance-md lint               # the file follows the spec
npm run build && npx performance-md check --report   # budgets and rules, with each page's sizes
```

To measure, install Lighthouse, which the CLI pins and loads only for `measure`:

```sh
npm install --no-save lighthouse@12.6.1
npx performance-md measure results --base ../main/dist --head dist
npx performance-md compare results --comment comment.md
```

## Use in CI

Two checks, each where it fits:

- **Deploy gate:** add `performance-md check` after your build (for example in `npm test`). It needs no browser, so a host's build can run it.
- **Pull requests:** build the base and the PR, measure the pages that differ, and compare. The CLI never talks to GitHub: `compare` prints a report and, when something got better and nothing got worse, writes a comment file for your workflow to post.

A GitHub Actions job for a site at the repository root, with `performance-md` in its devDependencies:

```yaml
name: Performance
on: pull_request
permissions:
  contents: read
  pull-requests: write # to post the comment
jobs:
  measure:
    name: Validate Page Speed
    runs-on: ubuntu-latest # has Chrome
    steps:
      - uses: actions/checkout@v5
        with: { path: head }
      - uses: actions/checkout@v5
        with: { path: base, ref: "${{ github.event.pull_request.base.sha }}" }
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - name: Build both
        run: for side in base head; do (cd "$side" && npm ci && npm run build); done

      # Identical files give identical results, so only pages that differ are measured.
      - name: Find changed pages
        id: pages
        working-directory: head
        run: echo "list=$(npx performance-md changed ../base/dist dist | tr '\n' ' ')" >> "$GITHUB_OUTPUT"

      # With no pages given, measure takes every page: skip it when nothing changed.
      - name: Measure
        if: steps.pages.outputs.list != ''
        working-directory: head
        env:
          PAGES: ${{ steps.pages.outputs.list }} # through env, never ${{ }} in the script: page names come from the PR
        run: |
          npm install --no-save lighthouse@12.6.1
          # shellcheck disable=SC2086 # one argument per page
          npx performance-md measure ../results --base ../base/dist --head dist $PAGES

      - name: Compare
        if: steps.pages.outputs.list != ''
        working-directory: head
        run: |
          set +e
          npx performance-md compare ../results --comment ../comment.md > ../report.txt
          status=$?
          cat ../report.txt
          { echo '```text'; cat ../report.txt; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
          exit $status

      # One comment, found by its marker: updated on each push, removed if the gain disappears.
      - name: Post or remove the comment
        if: ${{ !cancelled() }}
        env:
          GH_TOKEN: ${{ github.token }}
          MARKER: "<!-- performance-md:web -->" # web: the `name` in PERFORMANCE.md, or its folder's name
          COMMENTS: repos/${{ github.repository }}/issues/${{ github.event.pull_request.number }}/comments
        run: |
          existing=$(gh api "$COMMENTS" --paginate --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | head -1)
          if [ -f comment.md ]; then
            if [ -n "$existing" ]; then gh api -X PATCH "repos/${{ github.repository }}/issues/comments/$existing" -F body=@comment.md > /dev/null
            else gh api "$COMMENTS" -F body=@comment.md > /dev/null; fi
          elif [ -n "$existing" ]; then
            gh api -X DELETE "repos/${{ github.repository }}/issues/comments/$existing"
          fi

      - uses: actions/upload-artifact@v4 # results.jsonl and each run's Lighthouse report
        if: ${{ !cancelled() && steps.pages.outputs.list != '' }}
        with: { name: performance, path: results }
```

For a site in a subfolder, add it to the paths (`head/apps/web`, `../../../base/apps/web/dist`); `measure` and `compare` take paths relative to where they run.

## Commands

| Command | Does | Exit |
|---------|------|------|
| `lint [--strict] [--all]` | Checks the file against the spec | 1 on any error |
| `check [--dist <path>] [--report]` | Checks `artifact.budgets` and `artifact.rules` on the build | 1 on any broken budget or rule |
| `changed <base> <head>` | Prints the pages that differ between two builds | 0 |
| `measure <out> --head <path\|url> [--base <path\|url>] [targets…]` | Runs Lighthouse, alternating base and head, into `<out>/results.jsonl` | 1 if a run fails |
| `compare <out> [--comment <file>]` | Checks limits on head and deltas against base | 1 on any broken limit or regression |

Every command finds the nearest `PERFORMANCE.md` from the current folder upwards, or takes `--file <path>`. Usage errors exit 2. Requires Node 22 or later.
