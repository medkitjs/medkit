---
'@medkitjs/vite': minor
---

`medkit()` for Vite (and Astro, which runs on it): `import hero from './hero.jpg?medkit'` processes the image or video into `outDir` from `medkit.config.js` during dev and build, and gives its manifest. Per-file video options in `video.files` are keyed from `srcDir`, as for the CLI; an import outside `srcDir` gets the video defaults. A key that names no video, two sources with the same name, or a `?medkit` import that is neither an image nor a video fails the build. `@medkitjs/vite/client` types each import as an image or a video manifest by extension.
