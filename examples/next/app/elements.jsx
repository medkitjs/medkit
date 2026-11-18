'use client';

import { useEffect } from 'react';

// Client components also render on the server, where customElements does not
// exist; the elements are imported once the page runs in the browser.
export default function Elements() {
  useEffect(() => {
    import('@medkitjs/elements/image');
    import('@medkitjs/elements/video-bg');
    import('@medkitjs/elements/player');
  }, []);
  return null;
}
