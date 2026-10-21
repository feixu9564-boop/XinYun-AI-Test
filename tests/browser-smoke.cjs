// Optional integration check. Start uvicorn on 127.0.0.1:8000 first.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const context = await browser.newContext({permissions: ['camera']});
    const page = await context.newPage();
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {
      if (!r.url().startsWith('http://127.0.0.1:8000/')) external.push(r.url());
    });
    await page.goto('http://127.0.0.1:8000');
    for (const button of ['#start', '#reset']) {
      await page.click(button);
      await page.waitForFunction(() => document.querySelector('#face').textContent === '未检测到人脸', null, {timeout: 30000});
      assert.equal(await page.locator('#bpm').innerText(), '—');
      await page.click('#stop');
      assert.ok(await page.evaluate(() => document.querySelector('video').srcObject === null));
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS: local MediaPipe/WASM initialization, no-face rejection, stop/restart, no external requests');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
