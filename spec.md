# PERFORMANCE.md format — version 1 (alpha draft)

A `PERFORMANCE.md` file states what "fast enough" means for one surface (a website, an API, an app) and why. Its YAML front matter holds the rules, which a tool checks; the Markdown below it holds the reasons, which people and agents read. Nothing about the project is assumed: everything the checks depend on is either written in the file or a default documented here.

Status: alpha. Version 1 may still change before the first tagged release; after that, the rules in [Compatibility](#compatibility) apply.

## The file

- Named `PERFORMANCE.md`, placed next to the code it measures (in a monorepo, one per app: `apps/web/PERFORMANCE.md`).
- Front matter between `---` lines at the very top; Markdown after it, free-form.
- One file describes one surface.
- Every path in the file is relative to the file's own folder.
- Tools find the nearest `PERFORMANCE.md` from the current folder upwards, unless given `--file`.

## Front matter

```yaml
version: 1             # required; the format version, not the tool's
kind: web              # required; see Kinds
name: web              # optional; defaults to the folder name. Unique across a repository.
artifact: {}           # what to inspect; fields depend on kind
targets: []            # what to check: pages, endpoints, screens. Default: depends on kind
budgets: {}            # limits on the artifact, checked without running it
measure: {}            # how to collect measured runs
slos: []               # limits on statistics over measured runs
compare: {}            # regression rules against a baseline
overrides: {}          # per-target changes to budgets, slos or compare
```

Unknown top-level keys are an error, except keys starting with `x-`, which tools ignore.

### Quantities

Every limit carries its unit, so a wrong unit is a lint error rather than a silent factor of 1000.

| Unit | Meaning |
|------|---------|
| `B`, `KB`, `MB` | bytes; **1 KB = 1024 B**, 1 MB = 1024 KB |
| `ms`, `s` | time |
| `%` | percentage (of a ratio, or of a baseline in `compare.noise`) |
| none | unitless (Lighthouse score 0–100, CLS) |

Written as a number, an optional space and the unit: `175 KB`, `2.5 s`, `0.1`, `2%`. A metric only accepts units of its own dimension.

### budgets

Fixed limits on what the surface ships, read from the artifact without running it: deterministic, so they fit a deploy gate. Each kind defines its budget keys (see Kinds). A budget that isn't written isn't checked.

### measure

```yaml
measure:
  tool: lighthouse     # required if slos or compare are present; see Kinds for each kind's tools
  runs: 7              # per side when comparing; default 5
  # tool-specific options
```

### slos

```yaml
slos:
  - { metric: lcp, stat: median, limit: 2.5 s }
```

Each entry: `metric` (from the kind's metric list), `stat` and `limit`. A target fails if the statistic over its runs is worse than the limit; "worse" follows the metric's direction (most are lower-is-better).

`stat` is one of: `median`, `mean`, `min`, `max`, `worst` (the worst run in the metric's direction), `p<N>` (nearest-rank percentile, e.g. `p95`).

Reserved for later, so adding them is not a breaking change: `objective` and `window` (production SLOs such as 99.9% over 28 days) and `source` (`lab`, the only value in version 1, or later `production`). Version 1 tools reject them with "not supported yet" rather than ignoring them, so no one thinks they are enforced.

### compare

```yaml
compare:
  noise: 2%
  thresholds: { lcp: 50 ms, cls: 0.01 }
```

Compares a head (a pull request) with a base (main), measured the same way. For each target and each metric in `thresholds`, using the same `stat` as that metric's SLO (`median` if it has none):

- **regressed** if it got worse by more than both its threshold and `noise` × the base value;
- **improved** if it got better by more than both;
- otherwise **on par**.

Any regression fails the comparison. A metric not in `thresholds` isn't compared.

### overrides

```yaml
overrides:
  /pricing: { budgets: { js: 10 KB } }
```

Keyed by target. Each value may hold `budgets`, `slos` or `compare`, merged over the file's: a budget key replaces the same key; an SLO replaces the file's entry with the same `metric` and `stat`. Overriding a target that doesn't exist is an error.

## Kinds

A kind names what is measured and defines its `artifact` fields, default `targets`, budget keys, metrics and measurement tools. Version 1 defines `web`. `api` and `ios` are reserved names.

### web

A static site built to a folder.

```yaml
artifact:
  dist: dist                  # required; the built site
  origin: https://example.com # required; the site's own origin
  routes:
    clean_urls: true          # /about serves about.html; default false
  hashed_assets: "_astro/**"  # glob of content-hashed files; default none. Used by `changed`.
  fonts: unicode-range        # count a @font-face only if the page uses characters in its range (default), or `all`
```

**targets:** paths such as `/` or `/privacy`. Default: every `.html` file in `dist`.

**What counts as a page's download:** the HTML; stylesheets it links and inline `<style>`; scripts it loads; images in `<img src>` (and `srcset`: the largest candidate, an upper bound); `<link rel="preload|icon">`; and, from CSS, `url()` references and the first `src` of each `@font-face` that the `fonts` rule selects. All weights of a matching family count (an upper bound). Sizes are uncompressed bytes on disk.

**budgets:**

| Key | Limits |
|-----|--------|
| `total` | everything a page downloads |
| `html`, `css`, `js`, `fonts`, `images` | that type (inline CSS and JS count against `css` and `js`) |
| `image_max` | any single image |
| `image_formats` | list of allowed formats, e.g. `[svg, webp, avif]` |
| `image_dimensions` | `true`: every `<img>` has `width` and `height` |
| `origins` | where resources may load from: `self` and any other origins listed. Plain links don't count. |

**measure tools:** `lighthouse`, options `preset` (`mobile` default, or `desktop`). The tool serves `dist` locally following `routes`, with text compressed.

**metrics:** `score` (higher is better, 0–100), `fcp`, `lcp`, `tbt` (time), `cls` (unitless), `transfer` (bytes as transferred, compressed).

## Commands

| Command | Does | Exit |
|---------|------|------|
| `performance-md lint [--strict] [--all]` | Checks the file against this spec. `--strict` requires every defaulted field to be written. `--all` checks every `PERFORMANCE.md` under the current folder, including that names are unique. | 1 on any error |
| `performance-md check [--report]` | Checks `budgets` against the artifact. `--report` prints measured sizes. Never needs a browser or network. | 1 on any broken budget |
| `performance-md changed <base> <head>` | Prints the targets whose artifact differs, one per line. | 0 |
| `performance-md measure <out> [--base <artifact>] [targets…]` | Runs `measure.tool`, alternating base and head when both are given, and writes results. | 1 if the tool fails |
| `performance-md compare <base-results> <head-results> [--comment <file>]` | Checks `slos` on head and `compare` against base; prints a plain-text report. Writes `<file>` only when something improved and nothing regressed. | 1 on any broken SLO or regression |

Tools needed only by `measure` (Lighthouse, a browser) are optional dependencies, so `lint`, `check`, `changed` and `compare` stay light.

## Results

`measure` writes one JSON object per line to `<out>/results.jsonl`; `compare` reads only this, so new tools need no change to it:

```json
{"name":"web","side":"head","target":"/","run":1,"metric":"lcp","value":1432,"unit":"ms"}
```

## Compatibility

- Within version 1, changes are additive: new kinds, metrics, tools, stats and optional fields. The meaning of an existing key never changes.
- A tool that meets a kind, tool, metric or field it doesn't know fails with the version it needs. It never skips: a skipped check reads as a pass.
- Reserved for later minor versions: `surfaces` (several surfaces in one file), `extends` (shared defaults), and the SLO fields above.

## Example

```yaml
---
version: 1
kind: web
artifact:
  dist: dist
  origin: https://myhutch.app
  routes: { clean_urls: true }
  hashed_assets: "_astro/**"
budgets:
  total: 175 KB
  html: 13 KB
  css: 20 KB
  fonts: 140 KB
  images: 4 KB
  js: 0 B
  image_max: 100 KB
  image_formats: [svg, webp, avif]
  image_dimensions: true
  origins: [self]
measure: { tool: lighthouse, preset: mobile, runs: 7 }
slos:
  - { metric: score, stat: worst,  limit: 90 }
  - { metric: fcp,   stat: median, limit: 1.8 s }
  - { metric: lcp,   stat: median, limit: 2.5 s }
  - { metric: tbt,   stat: median, limit: 200 ms }
  - { metric: cls,   stat: worst,  limit: 0.1 }
compare:
  noise: 2%
  thresholds: { score: 1, fcp: 50 ms, lcp: 50 ms, tbt: 50 ms, cls: 0.01, transfer: 2 KB }
---

# Performance

Why each rule exists goes here.
```
