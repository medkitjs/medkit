---
'@medkitjs/elements': minor
---

Every label can be translated: `configure({ labels })` overrides the English ones, `registerLocale('sr', {…})` applies to elements whose nearest `lang` is `sr` or `sr-…`, and a `labels` attribute (JSON) overrides one element. An element's own labels win over its locale's, which win over `configure()`'s. `renderVideoBg()` and the React and Astro components take a `labels` object and write the attribute. The background's play and pause keys are now `playBackground` and `pauseBackground`.
