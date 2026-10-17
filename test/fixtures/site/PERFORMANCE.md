---
version: "1.0"
name: site
artifact:
  type: static-site
  dist: dist
  origin: https://example.com
  routes: { clean_urls: true }
  fonts: unicode-range
  budgets:
    total: 10 KB
    html: 2 KB
    js: 0 B
  rules:
    image_formats: [svg, webp, avif]
    image_dimensions: true
    origins: [self]
  overrides:
    /privacy: { budgets: { html: 3 KB, js: 1 KB }, rules: { origins: [self, https://cdn.example.com] } }
measure:
  tool: lighthouse
  preset: mobile
  runs: 5
  noise: 2%
  metrics:
    - { metric: lcp, stat: median, limit: 2.5 s, delta: 50 ms }
    - { metric: cls, stat: worst, limit: 0.1, delta: 0.01 }
  overrides:
    /blog/: { metrics: [{ metric: lcp, stat: median, limit: 3 s }] }
---

# Performance

A tiny site for the tests.
