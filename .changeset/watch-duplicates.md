---
'@medkitjs/cli': patch
---

`medkit process --watch` refuses a new image whose name another image already owns, instead of overwriting that image's output.
