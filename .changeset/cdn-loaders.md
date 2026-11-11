---
'@medkitjs/elements': minor
'@medkitjs/core': minor
---

CDN loaders for Cloudinary, imgix, Cloudflare Images and ImageKit, plus `defineLoader()` for any other. `renderImage(src, { loader, width, height, alt })` and `preloadTags()` render CDN images with one srcset; with no build step, `<medkit-image src>` renders its own image through a loader set with `configure()`. `pickWidths()` and `DEFAULT_WIDTHS` move from `@medkitjs/core` to `@medkitjs/elements`, shared by both paths.
