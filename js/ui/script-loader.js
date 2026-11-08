export const HTML2CANVAS_URL =
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
export const HTML2CANVAS_INTEGRITY =
  'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H';

/** Load optional browser libraries once per in-flight request; failures are retryable. */
export function createScriptLoader({
  document = globalThis.document,
  globals = globalThis,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
} = {}) {
  const pending = new Map();

  return function loadScript({
    src,
    globalName,
    timeoutMs = 15000,
    integrity,
    validate = (value) => value != null,
  }) {
    if (!src || !globalName || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new TypeError('Invalid optional script configuration.'));
    }
    if (validate(globals[globalName])) return Promise.resolve(globals[globalName]);
    const key = `${src}\n${globalName}\n${integrity || ''}`;
    if (pending.has(key)) return pending.get(key);
    if (!document?.createElement || !document.head?.append) {
      return Promise.reject(new Error('Optional scripts require a browser document.'));
    }

    const request = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else {
          resolve(globals[globalName]);
        }
      }
      script.src = src;
      script.async = true;
      if (integrity) {
        script.integrity = integrity;
        script.crossOrigin = 'anonymous';
      }
      script.onload = () => {
        try {
          finish(
            validate(globals[globalName])
              ? null
              : new Error('Optional script did not expose its expected API.'),
          );
        } catch (error) {
          finish(error);
        }
      };
      script.onerror = () =>
        finish(new Error('تعذر تحميل أداة الصور. تحقق من الاتصال وأعد المحاولة.'));
      const timer = setTimeout(
        () => finish(new Error('انتهت مهلة تحميل أداة الصور. أعد المحاولة.')),
        timeoutMs,
      );
      try {
        document.head.append(script);
      } catch (error) {
        finish(error);
      }
    });
    pending.set(key, request);
    // Clear failures and successes alike. Successful libraries are read from globals,
    // so replacing/removing a library cannot leave a stale cached result behind.
    request.then(
      () => pending.delete(key),
      () => pending.delete(key),
    );
    return request;
  };
}

let browserLoader;
export function loadHtml2Canvas() {
  browserLoader ??= createScriptLoader();
  return browserLoader({
    src: HTML2CANVAS_URL,
    integrity: HTML2CANVAS_INTEGRITY,
    globalName: 'html2canvas',
    validate: (value) => typeof value === 'function',
  });
}
