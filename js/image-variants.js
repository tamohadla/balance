// Same progressive JPEG reduction as the approved 150 × 200 preview.
export const thumbnailPath = path => path ? `${path}.thumb-200.jpg` : '';
export async function resizeImageBlob(blob, maxSide = 200) {
  const source = new Image(), url = URL.createObjectURL(blob);
  try {
    source.src = url;
    await source.decode();
    const scale = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
    const width = Math.max(1, Math.round(source.naturalWidth * scale));
    const height = Math.max(1, Math.round(source.naturalHeight * scale));
    let input = source, w = source.naturalWidth, h = source.naturalHeight;
    function draw(w, h) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', {alpha:false});
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(input, 0, 0, w, h);
      return canvas;
    }
    while (w / 2 >= width && h / 2 >= height) {
      w = Math.max(width, Math.round(w / 2)); h = Math.max(height, Math.round(h / 2));
      input = draw(w, h);
    }
    const canvas = draw(width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('تعذر تجهيز الصورة.')), 'image/jpeg', .9));
  } finally { URL.revokeObjectURL(url); }
}
