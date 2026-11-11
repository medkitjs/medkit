---
'@medkitjs/core': minor
'@medkitjs/cli': minor
---

`medkit process <dir>` processes every image in a folder, with `--out`, `--watch` and `--concurrency`, and exits with 1 when any file fails. `loadConfig()` reads `outDir` and `baseUrl` from `medkit.config.js` and refuses unknown options.
