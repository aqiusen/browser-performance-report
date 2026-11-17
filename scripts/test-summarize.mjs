import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-map-test-'));
try {
  const capture = path.join(root, 'capture');
  const dist = path.join(root, 'dist');
  fs.mkdirSync(capture);
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  const bundle = path.join(dist, 'assets', 'app-hash.js');
  fs.writeFileSync(bundle, 'function a(){}');
  fs.writeFileSync(`${bundle}.map`, JSON.stringify({ version: 3, file: 'app-hash.js', sources: ['../../src/App.jsx'], sourcesContent: ['function calculateRiskScore() {}'], names: ['calculateRiskScore'], mappings: 'AAAAA' }));
  fs.writeFileSync(path.join(capture, 'profile.json'), JSON.stringify({
    nodes: [{ id: 1, callFrame: { functionName: 'a', url: 'https://example.test/app/assets/app-hash.js', lineNumber: 0, columnNumber: 0 } }],
    samples: [1], timeDeltas: [1000],
  }));
  const script = new URL('./summarize.mjs', import.meta.url).pathname;
  const run = (...extra) => JSON.parse(execFileSync(process.execPath, [script, capture, ...extra], { encoding: 'utf8' }));
  assert.equal(run().topFunctions[0].original, null);
  const mapped = run('--asset-root', dist, '--asset-base', 'https://example.test/app/');
  assert.deepEqual(mapped.topFunctions[0].original, {
    source: '../../src/App.jsx', line: 1, column: 1, name: 'calculateRiskScore', sourceContentAvailable: true,
  });
  assert.equal(run('--asset-root', dist, '--asset-base', 'https://example.test/other/').topFunctions[0].original, null);
  fs.unlinkSync(`${bundle}.map`);
  const missing = run('--asset-root', dist, '--asset-base', 'https://example.test/app/');
  assert.equal(missing.topFunctions[0].original, null);
  assert.match(missing.sourceMap.notes[0], /Cannot use source map/);
  console.log('source map attribution and fallback ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
