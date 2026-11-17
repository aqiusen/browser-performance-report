# Ego capture recipe

Run `ego-browser skill` first and follow its currently installed guide. `ego-browser nodejs < /absolute/path/to/generated-capture.js` executes a single script. The agent creates that short, scenario-specific script in the output directory after inspecting the page; **only that generated script contains the user's selectors/actions**. Do not copy selectors from previous reports. Ego's JS process is new each invocation, so start and stop tracing/profiling in the same invocation.

Adapt this skeleton to the user's actions and completion signal. Save files with absolute paths. Follow ego's single TaskSpace and `finish()` lifecycle. In the example below, `performUserSteps` and `waitForVisibleCompletion` are placeholders for actions grounded in a fresh snapshot, not functions supplied by the website. On an action failure, retain whatever evidence exists and report that the run was incomplete.

```js
const fs = await import('node:fs/promises');
const out = '/absolute/report/directory';
await fs.mkdir(`${out}/screenshots`, { recursive: true });
const task = await taskSpace('unique-diagnosis-name');
const page = task.page('p1');
await page.goto('USER_URL');
console.log(await page.snapshot()); // First inspect; choose selectors from the result.
await page.screenshot({ path: `${out}/screenshots/before.png` });

let tracing = false;
let profiling = false;
let error;
let startedAt;
let completedAt;
try {
  await page.cdp('Network.enable');
  await page.cdp('Profiler.enable');
  await page.events(); // Discard navigation/setup events before measuring the user's actions.
  await page.cdp('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,toplevel,v8,blink.user_timing',
    transferMode: 'ReturnAsStream',
  });
  tracing = true;
  await page.cdp('Profiler.start');
  profiling = true;
  startedAt = new Date().toISOString();

  // INSERT user-defined steps, e.g. page.click, page.fill, page.press.
  // await performUserSteps(page);
  // Wait for the observed result, not an arbitrary sleep or network idle.
  // await waitForVisibleCompletion(page);
  const paintOpportunity = await page.evaluate(() => new Promise(resolve => {
    const timeout = setTimeout(() => resolve(false), 5000);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTimeout(timeout);
      resolve(true);
    }));
  }));
  if (!paintOpportunity) throw new Error('No paint opportunity after completion');

  completedAt = new Date().toISOString();
} catch (caught) {
  error = String(caught);
} finally {
  const recordError = caught => { error = [error, String(caught)].filter(Boolean).join('\n'); };
  try {
    if (profiling) {
      const { profile } = await page.cdp('Profiler.stop');
      await fs.writeFile(`${out}/profile.json`, JSON.stringify(profile));
    }
  } catch (caught) { recordError(caught); }
  try {
    if (tracing) {
      await page.cdp('Tracing.end');
      let stream;
      const events = [];
      const deadline = Date.now() + 15000;
      while (!stream && Date.now() < deadline) {
        const batch = await page.events();
        for (const e of batch) {
          const p = e.params || {};
          const base = { requestId: p.requestId, timestamp: p.timestamp };
          if (e.method === 'Network.requestWillBeSent' && /^https?:/.test(p.request?.url || '')) {
            const url = new URL(p.request.url);
            events.push({ method: e.method, params: { ...base,
              request: { url: `${url.origin}${url.pathname}`, method: p.request.method } } });
          } else if (e.method === 'Network.responseReceived') {
            events.push({ method: e.method, params: { ...base, response: { status: p.response.status } } });
          } else if (e.method === 'Network.loadingFinished') {
            events.push({ method: e.method, params: { ...base, encodedDataLength: p.encodedDataLength } });
          } else if (e.method === 'Network.loadingFailed') {
            events.push({ method: e.method, params: { ...base, errorText: p.errorText } });
          }
        }
        stream = batch.find(e => e.method === 'Tracing.tracingComplete')?.params?.stream;
        if (!stream) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (stream) {
        let data = '', eof = false;
        while (!eof) {
          const chunk = await page.cdp('IO.read', { handle: stream, size: 1024 * 1024 });
          data += chunk.data;
          eof = chunk.eof;
        }
        await page.cdp('IO.close', { handle: stream });
        await fs.writeFile(`${out}/trace.json`, data);
      } else {
        recordError('Trace stream timed out');
      }
      await fs.writeFile(`${out}/network.json`, JSON.stringify(events));
    }
  } catch (caught) { recordError(caught); }
  try { await page.screenshot({ path: `${out}/screenshots/after.png` }); }
  catch (caught) { recordError(caught); }
  try {
    const url = new URL(await page.url());
    await fs.writeFile(`${out}/scenario.json`, JSON.stringify({
      startedAt, completedAt, url: `${url.origin}${url.pathname}`,
      steps: ['ACTUAL USER STEPS'], completion: 'OBSERVED VISIBLE STATE',
    }, null, 2));
  } catch (caught) { recordError(caught); }
  try {
    if (error) await fs.writeFile(`${out}/capture-error.txt`, error);
  } finally {
    await task.finish({ keep: [] });
  }
}
```

This skeleton is a reference, not a blind copy/paste program. In particular, take the **before** screenshot after establishing the requested initial state, and make the **after** screenshot only after an observable completion condition. For slow initial navigation, start recording before navigation instead. If a trace is large, keep the interaction short and avoid repeated full-page screenshots. Profile and trace collection have overhead: compare like with like and avoid claiming a one-millisecond precision from a single run.

The raw trace/profile may contain internal URLs, identifiers, and source names. Keep them local unless the user explicitly authorizes sharing. The filtered `network.json` contains only request method, URL without query, status, byte count, and timing. Do not screenshot a credential form. Inspect `capture-error.txt` before analysis.
