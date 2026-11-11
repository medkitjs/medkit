---
'@medkitjs/elements': minor
---

`renderImage()` and client-rendered CDN images reject a `fit` that is not an `object-fit` keyword and a colour that is not hex, because both land in CSS unquoted.
