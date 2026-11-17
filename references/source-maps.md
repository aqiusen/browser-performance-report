# Production source maps

The CPU profile records generated script URL and zero-based line/column. The summarizer can resolve that **function entry position** with Node's SourceMap parser when the exact deployed build exists locally. Use:

```sh
node <skill-dir>/scripts/summarize.mjs <capture-dir> \
  --asset-root /absolute/path/to/dist \
  --asset-base https://deployed.example/app/ > <capture-dir>/metrics.json
```

The URL prefix maps to the build root: `https://deployed.example/app/assets/a.js` matches `<dist>/assets/a.js`. This works for Vue and React bundles alike. The `.map` can be a sibling file (including a hidden source map without a `sourceMappingURL` comment) or referenced by the bundle comment. Never search arbitrary directories by basename or silently substitute a different version. A source map only maps locations; it does not reveal React/Vue component render phases by itself. For that, use framework profiling/instrumentation if warranted.

In the report show generated URL:line:column alongside mapped source:line:column, mention whether `sourcesContent` is present, and open the original source where available to confirm the surrounding function. The `original` field is null when no mapping can be established. Record absent or invalid maps, version uncertainty, and source path only when actually verified. Source-map contents can include proprietary code: keep raw maps and traces local; never upload or expose a hidden map just to diagnose a page. When no map/build exists, report phase and generated location with lower source attribution confidence.
