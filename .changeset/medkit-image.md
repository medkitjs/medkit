---
'@medkitjs/elements': minor
---

`<medkit-image>` fades a lazy image in over its placeholder and removes the placeholder once the image loads; priority images, reduced motion and broken images are never hidden. A development build with console warnings (missing `alt` or dimensions, more than one `priority`, a `priority` image that is not the largest paint, a file over twice its displayed size) is picked by the `development` export condition, or loaded directly as `@medkitjs/elements/image-dev`.
