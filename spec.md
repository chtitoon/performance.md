# PERFORMANCE.md format — version 1.0 (alpha)

A `PERFORMANCE.md` file states what "fast enough" means for one surface (a website, an API, an app) and why. Its YAML front matter holds the rules, which a tool checks; the Markdown below it holds the reasons, which people and agents read. Nothing about the project is assumed: everything a check depends on is written in the file, given on the command line, or a default documented here.

Status: alpha. Version 1.0 may still change before the first tagged release; after that, the rules in [Compatibility](#compatibility) apply.

## The file

- Named `PERFORMANCE.md`, placed next to the code it measures (in a monorepo, one per app: `apps/web/PERFORMANCE.md`).
- Front matter between `---` lines at the very top; Markdown after it, free-form.
- One file describes one surface.
- Every path in the file is relative to the file's own folder.
- Tools find the nearest `PERFORMANCE.md` from the current folder upwards, unless given `--file`.

## What goes in the file, and what doesn't

**A value goes in the file if it belongs to the surface; it goes on the command line if it changes with the occasion.** The limits, how the build is served and which tool measures it belong to the surface. Which build or URL is measured, which is the base and which the head, and which pages to measure this time change with the occasion: a pull request, a release, a scheduled check of the live site. Every new field is held to this test.

## Front matter

```yaml
version: "1.0"  # required; the format version this file needs, as "major.minor" (see Compatibility)
name: web       # optional; defaults to the folder name. Unique across a repository: results are keyed by it.
artifact: {}    # optional; what the surface ships, and budgets and rules on it
measure: {}     # optional; how to measure it, and limits and comparisons on the results
```

A file has `artifact`, `measure` or both. Unknown keys are an error at every level, except keys starting with `x-`, which tools ignore.

### Quantities

Every limit carries its unit, so a wrong unit is a lint error rather than a silent factor of 1000.

| Unit | Meaning |
|------|---------|
| `B`, `KB`, `MB` | bytes; **1 KB = 1024 B**, 1 MB = 1024 KB |
| `ms`, `s` | time |
| `%` | percentage (of a ratio, or of a base value in `measure.noise`) |
| none | unitless (a score, CLS) |

Written as a number, an optional space and the unit: `175 KB`, `2.5 s`, `0.1`, `2%`. A metric or budget only accepts units of its own dimension.

### Targets

A target is one thing checked: a page, an endpoint, a screen. Targets are never listed at the top of the file. They come from the artifact (a static site's pages are its HTML files) or from the tool's own settings when they can't be found automatically (an API's endpoints). Deriving them means a new page is checked without anyone remembering to add it. A run can narrow them on the command line.

`overrides`, in either section, are keyed by target. Overriding a target that doesn't exist is an error.

## artifact

What the surface ships, read without running it. Budgets and rules here are deterministic, so they fit a deploy gate.

```yaml
artifact:
  type: static-site   # required; decides the other settings, what a target is, and which budgets and rules exist
  # settings of the type
  budgets: {}         # size limits, applied to every target
  rules: {}           # requirements without a size, applied to every target
  overrides: {}       # per target: `budgets` and `rules` keys that replace the file's
```

A budget limits an amount; a rule is a requirement that holds or doesn't, such as an allowed list. A budget or rule that isn't written isn't checked.

```yaml
overrides:
  /pricing: { budgets: { js: 5 KB }, rules: { origins: [self, https://js.stripe.com] } }
```

## measure

How the surface is measured, and the limits on what's measured.

```yaml
measure:
  tool: lighthouse    # required; decides the other settings and which metrics exist
  runs: 7             # per side when comparing; default 5
  noise: 2%           # how noisy the measurement is, as a share of the base value; default 0%
  # settings of the tool
  metrics: []
  overrides: {}       # per target: `metrics` entries, merged over the file's
```

`measure` may also be a list of these, one per tool. Each entry's `metrics` apply to its own tool's results only.

What is measured is given on the command line: a path is a build, served locally following the `artifact` settings (so it needs an `artifact`); a URL is a running server.

### metrics

```yaml
metrics:
  - { metric: lcp,      stat: median, limit: 2.5 s, delta: 50 ms }
  - { metric: transfer, stat: median,               delta: 2 KB }
```

Each entry is one statistic of one metric, with the rules on it:

- `metric`: one the tool emits.
- `stat`: one of `median` (with an even number of runs, the mean of the two middle values), `mean`, `min`, `max`, `worst` (the worst run in the metric's direction) or `p<N>` (nearest-rank percentile: the value at rank ⌈N/100 × runs⌉ in ascending order, e.g. `p95`). With fewer than 100 / (100 − N) runs, `p<N>` is simply the maximum, so `lint` warns: `p95` needs at least 20 runs to mean anything.
- `limit`: the statistic over a target's runs must not be worse than this, in the metric's direction.
- `delta`: when a base is measured too, how much worse than the base still counts as on par.

An entry needs `limit`, `delta` or both. The same metric may appear with different stats (`lcp` at `median` and `p95`), each with its own rules; `metric` and `stat` together are unique.

With a base, each entry with a `delta` compares head with base:

- **regressed** if it got worse by more than both `delta` and `noise` × the base value;
- **improved** if it got better by more than both;
- otherwise **on par**.

A broken limit or a regression fails. Without a base, only limits are checked.

Reserved for later, so adding them is not a breaking change: `objective` and `window` (production objectives such as 99.9% over 28 days) and `source` (`lab` in version 1.0, later `production`). Until a version defines them, tools reject them with "not supported yet" rather than ignoring them, so no one thinks they are enforced.

### overrides

```yaml
overrides:
  /pricing: { metrics: [{ metric: lcp, stat: median, limit: 3 s }] }
```

An entry replaces the fields it sets on the file's entry with the same `metric` and `stat` (here the `limit`; the `delta` stays), or adds the entry if the file has none.

## Metrics

One list for every tool, so a metric means the same thing wherever it's measured. A tool declares which of these it emits; a new metric is added here, never redefined by a tool.

| Metric | Dimension | Better | Meaning |
|--------|-----------|--------|---------|
| `score` | unitless, 0–100 | higher | Lighthouse performance score |
| `fcp` | time | lower | First Contentful Paint |
| `lcp` | time | lower | Largest Contentful Paint |
| `tbt` | time | lower | Total Blocking Time |
| `cls` | unitless | lower | Cumulative Layout Shift |
| `transfer` | bytes | lower | bytes over the network, as transferred (compressed) |
| `latency` | time | lower | time from request to complete response |
| `error_rate` | % | lower | share of requests that failed |

No version 1.0 tool emits `latency` or `error_rate`; they are defined now so later tools can't define them differently.

## Artifact types

Each type defines its targets, how `measure` serves a build of it, and which targets changed between two builds. A type that can't tell which targets a change affects counts any change as affecting every target.

Version 1.0 defines `static-site`.

### static-site

A site built to a folder of files.

```yaml
artifact:
  type: static-site
  dist: dist                  # required; the built site
  origin: https://example.com # required; the site's own origin
  routes:
    clean_urls: true          # /about serves about.html; default false
  hashed_assets: "_astro/**"  # glob of content-hashed files; default none. Used to find changed pages.
  fonts: unicode-range        # count a @font-face only if the page uses characters in its range (default), or `all`
```

**Targets:** every `.html` file in `dist`, named by path (`/`, `/privacy`).

**Changed pages** (for `measure`): a page changed if its HTML differs. Files matching `hashed_assets` are skipped, because a change to one changes its name and so the HTML that links it. Any other file that differs, appears or disappears (a `favicon.svg`, say) counts as a change to every page.

**What counts as a page's download:** the HTML; stylesheets it links and inline `<style>`; scripts it loads; images in `<img src>` (and `srcset`: the largest candidate, an upper bound); `<link rel="preload|icon">`; and, from CSS, `url()` references and the first `src` of each `@font-face` that the `fonts` setting selects. All weights of a matching family count (an upper bound). Sizes are uncompressed bytes on disk; `transfer` in `measure` is the compressed counterpart.

**Budgets:**

| Key | Limits |
|-----|--------|
| `total` | everything a page downloads |
| `html`, `css`, `js`, `fonts`, `images` | that type (inline CSS and JS count against `css` and `js`) |
| `image_max` | any single image |

**Rules:**

| Key | Requires |
|-----|----------|
| `image_formats` | images in one of the listed formats, e.g. `[svg, webp, avif]` |
| `image_dimensions` | `true`: every `<img>` has `width` and `height` |
| `origins` | resources load only from `self` and any other origins listed. Plain links don't count. |

## Tools

Version 1.0 defines `lighthouse`. `command` is reserved: a later version may run any command that writes [results](#results), with metrics the file declares.

### lighthouse

```yaml
measure:
  tool: lighthouse
  preset: mobile              # or desktop; default mobile
```

**Measures against:** a `static-site` build (served locally, text compressed) or a URL.
**Targets:** the artifact's pages, whether measuring a build or a URL, so a check of the live site covers every page too. When base and head are both builds, only the [changed pages](#static-site): identical files give identical results. With no `artifact`, the paths given on the command line, or `/`.
**Emits:** `score`, `fcp`, `lcp`, `tbt`, `cls`, `transfer`.
**Version:** the CLI pins the Lighthouse version it runs and records it, with the browser's, in every result. Scores shift between Lighthouse and Chrome versions, so upgrading the CLI is a deliberate change: comparisons stay fair (both sides run on the same versions), but absolute limits may need a look.

## Commands

The `performance-md` CLI in this repository implements this section. It isn't on npm yet: install it from a commit (see the README).

| Command | Does | Exit |
|---------|------|------|
| `performance-md lint [--strict] [--all]` | Checks the file against this spec. `--strict` requires every defaulted field to be written. `--all` checks every `PERFORMANCE.md` under the current folder, including that names are unique. | 1 on any error |
| `performance-md check [--dist <path>] [--report]` | Checks `artifact.budgets` and `artifact.rules`. `--report` prints measured sizes. Never needs a browser or network. | 1 on any broken budget or rule |
| `performance-md measure <out> --head <path\|url> [--base <path\|url>] [--all \| targets…]` | Runs each `measure` tool, alternating base and head when both are given, and writes results. Given two builds, measures only the targets whose artifact differs; `--all` measures every target, and targets given on the command line are measured as given. | 1 if a tool fails |
| `performance-md compare <out> [--comment <file>]` | Checks each `metrics` limit on head and, when base results exist, each `delta`; prints a plain-text report. Writes `<file>` only when something improved and nothing regressed. | 1 on any broken limit or regression |

Tools needed only by `measure` (Lighthouse, a browser) are optional dependencies, so `lint`, `check` and `compare` stay light.

## Results

`measure` writes one JSON object per line to `<out>/results.jsonl`. `compare` reads only this, so a new tool needs no change to it:

```json
{"name":"web","tool":"lighthouse","tool_version":"12.6.1","browser":"Chrome/141.0.7390.54","side":"head","target":"/","run":1,"metric":"lcp","value":1432,"unit":"ms"}
```

`unit` is required: a unit of the metric's dimension from [Quantities](#quantities), or `""` for a unitless metric (`score`, `cls`). `compare` rejects a line whose unit doesn't fit its metric, so a tool reporting seconds can't pass for one reporting milliseconds.

`compare` refuses to compare base and head results recorded with different tool or browser versions.

When no target differs between two builds, `measure` writes an empty `results.jsonl`, and `compare` passes it: nothing changed, so nothing can have regressed. A file with results, none of them for this surface's `name`, is an error.

## Compatibility

- `version` is a quoted string, `"major.minor"`: unquoted, YAML would read `1.10` as the number 1.1.
- Within a major version, each minor version only adds: new artifact types, tools, metrics, stats and optional fields. The meaning of an existing key never changes. A new major version is for anything else.
- A file declares the lowest version that has everything it uses; `lint` says which that is. A tool supports one major version up to some minor; given a file that needs a later minor or another major, it fails with "this file needs 1.2; this tool supports up to 1.1". An old tool can't recognise a future field on its own, which is why the file declares its version.
- A tool never skips what it doesn't understand: a skipped check reads as a pass. Unknown types, tools, metrics or fields are errors, even in a file whose version the tool supports.
- Reserved for later minor versions: `surfaces` (several surfaces in one file), `extends` (shared defaults), `artifact.exclude`, `tool: command`, and the production fields of a `metrics` entry above.

## Example

```yaml
---
version: "1.0"
artifact:
  type: static-site
  dist: dist
  origin: https://example.com
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
  rules:
    image_formats: [svg, webp, avif]
    image_dimensions: true
    origins: [self]
measure:
  tool: lighthouse
  preset: mobile
  runs: 7
  noise: 2%
  metrics:
    - { metric: score,    stat: worst,  limit: 90,     delta: 1 }
    - { metric: fcp,      stat: median, limit: 1.8 s,  delta: 50 ms }
    - { metric: lcp,      stat: median, limit: 2.5 s,  delta: 50 ms }
    - { metric: tbt,      stat: median, limit: 200 ms, delta: 50 ms }
    - { metric: cls,      stat: worst,  limit: 0.1,    delta: 0.01 }
    - { metric: transfer, stat: median,                delta: 2 KB }
---

# Performance

Why each rule exists goes here.
```
