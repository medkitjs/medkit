---
'@medkitjs/elements': minor
---

`renderImage(manifest, options)` returns the finished `<medkit-image>` HTML, with art direction, the blur or colour placeholder and every attribute escaped; `preloadTags()` writes the `<link rel="preload">` tags for a hero image. `Image` components for React (`@medkitjs/elements/react`) and Astro (`@medkitjs/elements/astro`) render exactly the same markup. The placeholder now sits on the `<picture>`, so the element never changes attributes a framework rendered.
