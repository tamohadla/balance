import { recordImageReplacement, refreshSiteImages } from './image-cache.js';
import { resizeImageBlob, thumbnailPath } from './image-variants.js';
import { createImageStore } from './core/image-store.js';

// Browser composition only; storage transaction logic is platform-independent.
export const { saveImagePair, removeImagePair } = createImageStore({
  resizeImageBlob,
  thumbnailPath,
  recordImageReplacement,
  refreshSiteImages,
});
