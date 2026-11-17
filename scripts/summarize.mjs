#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { SourceMap } from 'node:module';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node summarize.mjs <capture-directory> [--asset-root <build-directory> --asset-base <deployed-base-url>]');
  process.exit(2);
}
const flag = name => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const assetRoot = flag('--asset-root');
const assetBase = flag('--asset-base');
if (Boolean(assetRoot) !== Boolean(assetBase)) {
  console.error('--asset-root and --asset-base must be provided together');
  process.exit(2);
}
const base = assetBase ? new URL(assetBase) : null;
const mapCache = new Map();
const mappingNotes = new Set();
const mapFrame = frame => {
  if (!base || !frame?.url || frame.lineNumber < 0 || frame.columnNumber < 0) return null;
  let url;
  try { url = new URL(frame.url); } catch { return null; }
  const prefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return null;
  const relative = decodeURIComponent(url.pathname.slice(prefix.length));
  const root = path.resolve(assetRoot);
  const bundle = path.resolve(root, relative);
  if (!bundle.startsWith(`${root}${path.sep}`) || !fs.existsSync(bundle)) {
    mappingNotes.add(`No matching local bundle for ${url.pathname}`);
    return null;
  }
  if (!mapCache.has(bundle)) {
    try {
      const content = fs.readFileSync(bundle, 'utf8');
      const match = content.match(/[#@]\s*sourceMappingURL=([^\s*]+)/g)?.at(-1)?.match(/sourceMappingURL=(.+)$/);
      const ref = match?.[1];
      const mapFile = ref && !ref.startsWith('data:') ? path.resolve(path.dirname(bundle), decodeURIComponent(ref)) : `${bundle}.map`;
      if (!mapFile.startsWith(`${root}${path.sep}`)) throw Error('map is outside asset root');
      const payload = ref?.startsWith('data:')
        ? JSON.parse(Buffer.from(ref.slice(ref.indexOf(',') + 1), ref.includes(';base64,') ? 'base64' : 'utf8').toString())
        : JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      if (payload.file && path.basename(payload.file) !== path.basename(bundle)) throw Error('map.file does not match bundle');
      mapCache.set(bundle, { map: new SourceMap(payload), payload });
    } catch (error) {
      mapCache.set(bundle, null);
      mappingNotes.add(`Cannot use source map for ${url.pathname}: ${error.message}`);
    }
  }
  const resolved = mapCache.get(bundle);
  if (!resolved) return null;
  const entry = resolved.map.findEntry(frame.lineNumber, frame.columnNumber);
  if (!entry.originalSource || entry.originalLine == null) return null;
  const index = resolved.payload.sources.indexOf(entry.originalSource);
  return {
    source: entry.originalSource,
    line: entry.originalLine + 1,
    column: entry.originalColumn + 1,
    name: entry.name || null,
    sourceContentAvailable: index >= 0 && typeof resolved.payload.sourcesContent?.[index] === 'string',
  };
};

const read = name => {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const profile = read('profile.json');
const trace = read('trace.json');
const network = read('network.json') || [];
const scenario = read('scenario.json');
const traceEvents = Array.isArray(trace) ? trace : trace?.traceEvents || [];
const actionMs = scenario?.startedAt && scenario?.completedAt
  ? Date.parse(scenario.completedAt) - Date.parse(scenario.startedAt) : null;

const profileNodes = new Map((profile?.nodes || []).map(node => [node.id, node]));
const selfMicros = new Map();
const sampleCounts = new Map();
for (let i = 0; i < (profile?.samples?.length || 0); i++) {
  const id = profile.samples[i];
  selfMicros.set(id, (selfMicros.get(id) || 0) + (profile.timeDeltas?.[i] || 0));
  sampleCounts.set(id, (sampleCounts.get(id) || 0) + 1);
}
const topFunctions = [...selfMicros].map(([id, micros]) => {
  const frame = profileNodes.get(id)?.callFrame;
  return {
    name: frame?.functionName || '(anonymous)',
    url: frame?.url || '',
    line: frame?.lineNumber >= 0 ? frame.lineNumber + 1 : null,
    column: frame?.columnNumber >= 0 ? frame.columnNumber + 1 : null,
    original: mapFrame(frame),
    sourceType: frame?.url?.startsWith('chrome-extension:') ? 'extension' : 'page-or-dependency',
    selfMs: Math.round(micros / 1000),
    samples: sampleCounts.get(id),
  };
}).filter(item => item.url)
  .sort((a, b) => b.selfMs - a.selfMs).slice(0, 20);

const interesting = new Set(['RunTask', 'Task', 'FunctionCall', 'Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'Paint', 'PrePaint', 'CompositeLayers', 'Commit']);
const rendererThreads = traceEvents.filter(event => event.ph === 'M' && event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
const threadScore = thread => traceEvents.reduce((sum, event) =>
  sum + (event.pid === thread.pid && event.tid === thread.tid && ['Layout', 'FunctionCall'].includes(event.name) ? (event.dur || 0) : 0), 0);
const mainThread = rendererThreads.sort((a, b) => threadScore(b) - threadScore(a))[0];
const timings = {};
for (const event of traceEvents) {
  if (mainThread && (event.pid !== mainThread.pid || event.tid !== mainThread.tid)) continue;
  if (event.ph !== 'X' || !interesting.has(event.name) || typeof event.dur !== 'number') continue;
  const bucket = timings[event.name] ||= { count: 0, maxMs: 0, over50ms: 0, top: [] };
  const ms = event.dur / 1000;
  bucket.count++;
  if (ms > 50) bucket.over50ms++;
  bucket.maxMs = Math.max(bucket.maxMs, ms);
  bucket.top.push({ ms, ts: event.ts, pid: event.pid, tid: event.tid,
    nodes: event.args?.beginData?.dirtyObjects ?? event.args?.data?.dirtyObjects ?? null });
  bucket.top.sort((a, b) => b.ms - a.ms);
  if (bucket.top.length > 5) bucket.top.pop();
}
for (const value of Object.values(timings)) {
  value.maxMs = Math.round(value.maxMs);
  value.top = value.top.map(item => ({ ...item, ms: Math.round(item.ms) }));
}

const requests = new Map();
for (const event of network) {
  const { requestId, timestamp, request, response } = event.params || {};
  if (!requestId) continue;
  const entry = requests.get(requestId) || { requestId };
  if (event.method === 'Network.requestWillBeSent') {
    entry.url = request?.url ? request.url.split('?')[0] : entry.url;
    entry.method = request?.method;
    entry.start = timestamp;
  }
  if (event.method === 'Network.responseReceived') entry.status = response?.status;
  if (event.method === 'Network.loadingFinished') {
    entry.end = timestamp;
    entry.bytes = event.params?.encodedDataLength;
  }
  if (event.method === 'Network.loadingFailed') entry.error = event.params?.errorText;
  requests.set(requestId, entry);
}
const requestSummary = [...requests.values()].filter(entry => /^https?:/.test(entry.url || ''))
  .map(({ start, end, ...rest }) => ({
  ...rest, durationMs: start != null && end != null ? Math.round((end - start) * 1000) : null,
})).sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 30);

console.log(JSON.stringify({
  scenario,
  actionToObservedStateMs: Number.isFinite(actionMs) ? actionMs : null,
  traceEventCount: traceEvents.length,
  mainThread: mainThread ? { pid: mainThread.pid, tid: mainThread.tid } : null,
  cpuSamples: profile?.samples?.length || 0,
  topFunctions,
  timings,
  requests: requestSummary,
  sourceMap: base ? { assetRoot: path.resolve(assetRoot), assetBase: base.href, notes: [...mappingNotes] } : null,
  notes: ['CPU self times are samples, not per-call durations.', 'Trace events may nest; do not sum their durations as wall time.', 'Screenshots show UI state, not exact completion time.'],
}, null, 2));
