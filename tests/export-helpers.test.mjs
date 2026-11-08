import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptLoader } from '../js/ui/script-loader.js';
import {
  waitForImages,
  imageExportScale,
  canvasToBlob,
  downloadBlob,
  exportElementToPng,
} from '../js/ui/image-export.js';

function clock() {
  let next = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimeout(fn, delay) {
      const id = ++next;
      jobs.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
    expire() {
      for (const [id, job] of [...jobs]) {
        jobs.delete(id);
        job.fn();
      }
    },
  };
}

function scriptEnvironment() {
  const scripts = [];
  const timers = clock();
  const globals = {};
  const document = {
    createElement() {
      return {
        removed: false,
        remove() {
          this.removed = true;
        },
      };
    },
    head: {
      append(script) {
        scripts.push(script);
      },
    },
  };
  return { scripts, timers, globals, load: createScriptLoader({ document, globals, ...timers }) };
}

const scriptConfig = {
  src: 'https://example.test/pinned-1.0.0.js',
  globalName: 'library',
  validate: (value) => typeof value === 'function',
};

test('optional script callers share a request, receive a validated API and release timers', async () => {
  const env = scriptEnvironment();
  const first = env.load({ ...scriptConfig, integrity: 'sha384-test' });
  const second = env.load({ ...scriptConfig, integrity: 'sha384-test' });
  assert.equal(first, second);
  assert.equal(env.scripts.length, 1);
  assert.equal(env.scripts[0].integrity, 'sha384-test');
  assert.equal(env.scripts[0].crossOrigin, 'anonymous');
  env.globals.library = () => 'renderer';
  env.scripts[0].onload();
  assert.equal(await first, env.globals.library);
  assert.equal(await env.load(scriptConfig), env.globals.library);
  assert.equal(env.scripts.length, 1);
  assert.equal(env.timers.jobs.size, 0);
  assert.equal(env.scripts[0].onload, null);
});

test('optional script timeout and missing API reject, remove scripts and allow retry', async () => {
  const env = scriptEnvironment();
  const first = env.load(scriptConfig);
  const timedOut = assert.rejects(first, /مهلة/);
  env.timers.expire();
  await timedOut;
  assert.equal(env.scripts[0].removed, true);
  assert.equal(env.scripts[0].onerror, null);
  const second = env.load(scriptConfig);
  const missing = assert.rejects(second, /expected API/);
  env.scripts[1].onload();
  await missing;
  assert.equal(env.scripts[1].removed, true);
  const third = env.load(scriptConfig);
  env.globals.library = () => {};
  env.scripts[2].onload();
  assert.equal(await third, env.globals.library);
});

test('optional script network failure is retryable and invalid configuration is rejected', async () => {
  const env = scriptEnvironment();
  const request = env.load(scriptConfig);
  const rejected = assert.rejects(request, /تعذر تحميل/);
  env.scripts[0].onerror();
  await rejected;
  assert.equal(env.timers.jobs.size, 0);
  await assert.rejects(env.load({ ...scriptConfig, timeoutMs: 0 }), /configuration/);
  await assert.rejects(createScriptLoader({ document: null })(scriptConfig), /browser document/);
});

class ImageStub extends EventTarget {
  complete = false;
  naturalWidth = 0;
  listeners = new Set();
  addEventListener(type, handler, options) {
    this.listeners.add(handler);
    super.addEventListener(type, handler, options);
  }
  removeEventListener(type, handler) {
    super.removeEventListener(type, handler);
    if (type === 'error') this.listeners.delete(handler);
  }
}

test('image waits release both listeners on load, error and timeout', async () => {
  for (const event of ['load', 'error', 'timeout']) {
    const timers = clock();
    const image = new ImageStub();
    const waited = waitForImages({ querySelectorAll: () => [image] }, timers);
    assert.equal(image.listeners.size, 1);
    if (event === 'timeout') timers.expire();
    else image.dispatchEvent(new Event(event));
    assert.deepEqual(await waited, [image]);
    assert.equal(image.listeners.size, 0);
    assert.equal(timers.jobs.size, 0);
  }
});

test('canvas scaling handles hidden elements and limits large captures', () => {
  assert.equal(imageExportScale(0, 0), 2);
  assert.equal(imageExportScale(undefined, Number.NaN), 2);
  const scale = imageExportScale(10000, 20000);
  assert.ok(10000 * 20000 * scale * scale <= 14000000 + 1);
  assert.throws(() => imageExportScale(10, 10, { maxPixels: 0 }), /positive/);
});

test('canvas encoding propagates errors and refuses an empty image', async () => {
  const expected = new Blob(['png']);
  assert.equal(await canvasToBlob({ toBlob: (callback) => callback(expected) }), expected);
  await assert.rejects(canvasToBlob({ toBlob: (callback) => callback(null) }), /تعذر إنشاء/);
  await assert.rejects(
    canvasToBlob({
      toBlob() {
        throw Error('tainted');
      },
    }),
    /tainted/,
  );
});

function downloadEnvironment({ failClick = false } = {}) {
  const timers = clock();
  const revoked = [];
  let anchor;
  const document = {
    createElement() {
      anchor = {
        removed: false,
        remove() {
          this.removed = true;
        },
        click() {
          if (failClick) throw Error('click blocked');
        },
      };
      return anchor;
    },
    body: { append() {} },
  };
  const URL = { createObjectURL: () => 'blob:export', revokeObjectURL: (url) => revoked.push(url) };
  return {
    options: { document, URL, ...timers },
    timers,
    revoked,
    get anchor() {
      return anchor;
    },
  };
}

test('blob download removes its anchor and eventually revokes its URL, including failures', () => {
  const env = downloadEnvironment();
  downloadBlob(new Blob(['png']), 'order.png', env.options);
  assert.equal(env.anchor.download, 'order.png');
  assert.equal(env.anchor.removed, true);
  assert.equal(env.revoked.length, 0);
  env.timers.expire();
  assert.deepEqual(env.revoked, ['blob:export']);
  const failed = downloadEnvironment({ failClick: true });
  assert.throws(() => downloadBlob(new Blob(), 'order.png', failed.options), /blocked/);
  assert.equal(failed.anchor.removed, true);
  assert.deepEqual(failed.revoked, ['blob:export']);
  assert.equal(failed.timers.jobs.size, 0);
});

test('element export preserves capture options and reports failed images without blocking download', async () => {
  const env = downloadEnvironment();
  const image = { complete: true, naturalWidth: 0 };
  const element = { scrollWidth: 1000, scrollHeight: 1000, querySelectorAll: () => [image] };
  const blob = new Blob(['png']);
  const onclone = () => {};
  let rendered;
  const result = await exportElementToPng(element, {
    fileName: 'order.png',
    renderer: async (input, options) => {
      rendered = { input, options };
      return { toBlob: (callback) => callback(blob) };
    },
    canvasOptions: { onclone },
    downloadOptions: env.options,
  });
  assert.deepEqual(result, { blob, failedImages: true });
  assert.equal(rendered.input, element);
  assert.equal(rendered.options.onclone, onclone);
  assert.equal(rendered.options.useCORS, true);
  assert.equal(rendered.options.scale, 2);
  assert.equal(env.anchor.download, 'order.png');
  env.timers.expire();
});
