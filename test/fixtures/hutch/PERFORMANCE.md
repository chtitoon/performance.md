---
version: "1.0"
name: web
artifact:
  type: static-site
  dist: dist
  origin: https://myhutch.app
  routes: { clean_urls: true }
  hashed_assets: "_astro/**"
  budgets:
    total: 90 KB
    html: 13 KB
    css: 17 KB
    fonts: 56 KB
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
  runs: 5
  noise: 2%
  metrics:
    - { metric: score,    stat: worst,  limit: 99,     delta: 1 }
    - { metric: fcp,      stat: median, limit: 1.5 s,  delta: 50 ms }
    - { metric: lcp,      stat: median, limit: 1.5 s,  delta: 50 ms }
    - { metric: tbt,      stat: median, limit: 200 ms, delta: 50 ms }
    - { metric: cls,      stat: worst,  limit: 0.1,    delta: 0.01 }
    - { metric: transfer, stat: median,                delta: 2 KB }
---

# Hutch's numbers (apps/web/PERFORMANCE.md at e030d35) in the version 1.0 format.

`results/results.jsonl` is a real `measure` run of Hutch's build at that commit, the same build as
base and head, 5 runs per side (Lighthouse 12.6.1, Chrome for Testing 155). `report.txt` is what
`compare` prints for it. `dist` isn't kept: `compare` reads only the results.
