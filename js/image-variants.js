// Approved square 224px thumbnail: centered crop, progressive reduction, no blur.
export const thumbnailPath = path => path ? `${path}.thumb-224.jpg` : '';
export async function resizeImageBlob(blob, maxSide = 224, square = false) {
  const source = new Image(), url = URL.createObjectURL(blob);
  try {
    source.src = url;
    await source.decode();
    let input = source, w = source.naturalWidth, h = source.naturalHeight;
    if (square) {
      const side = Math.min(w, h), crop = document.createElement('canvas');
      crop.width = side; crop.height = side;
      const ctx = crop.getContext('2d', {alpha:false});
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, side, side);
      ctx.drawImage(source, (w-side)/2, (h-side)/2, side, side, 0, 0, side, side);
      input = crop; w = side; h = side;
    }
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));
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
