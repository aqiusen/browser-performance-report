# browser-performance-report

A reusable skill for diagnosing a slow web page or interaction from the user's own steps. It uses [ego-browser](https://lite.ego.app/) to capture Chrome performance, CPU-profile, and network evidence, then writes a Markdown report with before/after screenshots and prioritized recommendations. It does not change application code.

## Install

```sh
npx skills add aqiusen/browser-performance-report
```

Requirements: [ego-browser](https://lite.ego.app/) installed and configured, Node.js for the bundled metrics script, and access to the target page in the browser. Follow the installation prompts to select your agent. The skill uses the browser session you authorize; it does not require an app-specific test script.

## Use

Tell your agent the page, the ordered actions, and what looks slow. For example:

> Use browser-performance-report to analyze http://127.0.0.1:64243/: click "原始实现", then "查询订单". The table takes a long time to appear. Find the cause.

The skill chooses a visible completion signal, records a bounded interaction, and creates `performance-reports/<timestamp>/report.md` under the current project. The report links before/after screenshots, measured network/JavaScript/rendering evidence, source locations when verified, limitations, and specific experiments to remeasure. Raw trace, CPU profile, and network metadata remain alongside the report for inspection.

For production Vue or React bundles, supply the matching deployed build and source maps if you need original source attribution. Without matching maps, the report should cite the generated bundle location and state the uncertainty.

## Privacy

Captures may contain internal URLs, identifiers, source names, or proprietary code. Review and redact reports and raw evidence before sharing; do not publish traces, profiles, screenshots, or private source maps by default. This repository contains only the reusable skill, references, scripts, and evaluation prompts.

## Scope

The user defines the scenario. The skill diagnoses and reports; it does not alter business code. Read [SKILL.md](SKILL.md) for the workflow and [source-map guidance](references/source-maps.md) for attribution limits.
