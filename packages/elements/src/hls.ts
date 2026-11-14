// Opt-in: `import '@medkitjs/elements/hls'` lets <medkit-player> play HLS in
// browsers without native HLS. hls.js is an optional peer dependency needed
// only by this entry; the player never imports it, so a build without it
// installed still succeeds. It loads only when such a browser plays HLS.

import { registry } from './registry.js';

registry.hls = () => import('hls.js');
