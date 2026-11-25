import { Image, Player, VideoBg } from '@medkitjs/elements/react';
import lake from '../public/media/lake.json';
import river from '../public/media/river.json';
import talk from '../public/media/talk.json';

export default function Page() {
  return (
    <>
      <header>
        <VideoBg
          clips={[
            {
              video: river,
              title: 'Colour drifting over the river',
              overlay: <h1 style={{ margin: 0, padding: '30vh 1rem 1rem', color: '#fff', fontSize: 'clamp(2rem, 6vw, 3.5rem)' }}>medkit with Next.js</h1>,
            },
          ]}
          controls="pause"
          priority
        />
      </header>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
        <h2>An image</h2>
        <Image manifest={lake} alt="A pale sun over a teal lake with dark hills in front" sizes="(min-width: 800px) 720px, 100vw" />
        <h2>A video with sound and captions</h2>
        <Player video={talk} title="A tone over shifting colour" captions={[{ src: '/media/talk.en.vtt', srclang: 'en', label: 'English', default: true }]} />
      </main>
    </>
  );
}
