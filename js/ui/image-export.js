import { loadHtml2Canvas } from './script-loader.js';

/** Wait for load/error or a bounded timeout, releasing every listener afterward. */
export async function waitForImages(
  element,
  {
    timeoutMs = 8000,
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout,
  } = {},
) {
  const images = [...element.querySelectorAll('img')];
  await Promise.all(
    images.map((image) => {
      if (image.complete) return undefined;
      return new Promise((resolve) => {
        let settled = false;
        function done() {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          image.removeEventListener('load', done);
          image.removeEventListener('error', done);
          resolve();
        }
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        const timer = setTimeout(done, timeoutMs);
        // The image may have completed between the first check and listener setup.
        if (image.complete) done();
      });
    }),
  );
  return images;
}

/** Bound canvas allocation, including zero-sized/hidden DOM measurements. */
export function imageExportScale(width, height, { maxScale = 2, maxPixels = 14000000 } = {}) {
  if (
    !Number.isFinite(maxScale) ||
    maxScale <= 0 ||
    !Number.isFinite(maxPixels) ||
    maxPixels <= 0
  ) {
    throw new TypeError('Canvas limits must be positive finite numbers.');
  }
  const safeWidth = Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : 1;
  const safeHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : 1;
  return Math.min(maxScale, Math.sqrt(maxPixels / safeWidth / safeHeight));
}

export function canvasToBlob(canvas, { type = 'image/png', quality } = {}) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('تعذر إنشاء الصورة.'));
      },
      type,
      quality,
    );
  });
}

export function downloadBlob(
  blob,
  fileName,
  {
    document = globalThis.document,
    URL = globalThis.URL,
    setTimeout = globalThis.setTimeout,
    revokeDelayMs = 60000,
  } = {},
) {
  const objectUrl = URL.createObjectURL(blob);
  let anchor;
  try {
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  } finally {
    anchor?.remove();
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), revokeDelayMs);
}

export async function exportElementToPng(
  element,
  {
    fileName,
    renderer,
    loadRenderer = loadHtml2Canvas,
    canvasOptions = {},
    imageWaitOptions,
    downloadOptions,
  } = {},
) {
  if (!element || !fileName) throw new TypeError('An element and download filename are required.');
  const render = renderer ?? (await loadRenderer());
  if (typeof render !== 'function') throw new TypeError('The image renderer is unavailable.');
  const images = await waitForImages(element, imageWaitOptions);
  const canvas = await render(element, {
    backgroundColor: '#ffffff',
    useCORS: true,
    allowTaint: false,
    logging: false,
    ...canvasOptions,
    scale: imageExportScale(element.scrollWidth, element.scrollHeight),
  });
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, fileName, downloadOptions);
  return { blob, failedImages: images.some((image) => !image.naturalWidth) };
}
