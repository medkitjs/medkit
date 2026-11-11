import { label } from './strings.js';

/** One MP4 rendition, as renderVideoBg() writes it into a clip's `sources` attribute. */
export interface ClipSource {
  src: string;
  width: number;
  height: number;
  codec: string;
}

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zm6 0h4v14h-4z',
  soundOn: 'M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  soundOff: 'M4 9v6h4l5 4V5L8 9zm16.6 6.2-1.4 1.4-2.7-2.7-2.7 2.7-1.4-1.4 2.7-2.7-2.7-2.7 1.4-1.4 2.7 2.7 2.7-2.7 1.4 1.4-2.7 2.7z',
};

// The white icon sits on 60% black: at least 5.7:1 over a white frame, and the
// focus ring is white on a black halo, so both keep 3:1 over any video.
const CSS = `:host{display:block;position:relative;overflow:hidden}
[part=controls]{position:absolute;z-index:2;right:var(--medkit-controls-inset,16px);bottom:var(--medkit-controls-inset,16px);display:flex;gap:8px}
button{all:unset;box-sizing:border-box;display:grid;place-items:center;width:var(--medkit-control-size,44px);height:var(--medkit-control-size,44px);border-radius:50%;background:rgba(0,0,0,.6);color:#fff;cursor:pointer}
button[hidden]{display:none}
button:focus-visible{outline:2px solid var(--medkit-accent,#fff);box-shadow:0 0 0 4px #000}
svg{width:24px;height:24px;fill:currentColor}
@media (forced-colors:active){button{border:1px solid ButtonText;background:ButtonFace;color:ButtonText}}`;

// Hides iOS's own start button on a video that has no controls; a shadow root
// cannot reach a light-DOM video's pseudo-elements, so this goes in the page once.
const PAGE_CSS = 'medkit-video-bg video::-webkit-media-controls-start-playback-button{display:none!important}';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A muted, looping background video that never shows a black frame. The
 * server-rendered poster stays on top until the video has painted a real
 * frame, then fades out; nothing loads until the element is within 200px of
 * the viewport, and nothing at all with reduced motion, Save-Data or 2G.
 */
export class MedkitVideoBg extends HTMLElement {
  private clips: HTMLElement[] = [];
  private video?: HTMLVideoElement;
  private buttons: Record<string, HTMLButtonElement> = {};
  /** The visitor paused; only the visitor resumes. */
  private userPaused = false;
  /** At least 10% on screen and the tab visible. */
  private visible = true;
  private started = false;

  connectedCallback() {
    if (this.shadowRoot) return;
    this.clips = [...this.children].filter((c): c is HTMLElement => c.localName === 'medkit-clip');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    // Without a video there is nothing to pause, so no controls either.
    if (!this.clips.length || reducedMotion() || connection?.saveData || /2g/.test(connection?.effectiveType ?? '')) return;

    if (!document.getElementById('medkit-video-bg-css')) {
      document.head.insertAdjacentHTML('beforeend', `<style id="medkit-video-bg-css">${PAGE_CSS}</style>`);
    }
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><slot></slot><div part="controls"></div>`;
    const controls = root.lastElementChild!;
    const make = (name: string, onClick: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('part', 'button');
      button.onclick = onClick;
      controls.append(button);
      return (this.buttons[name] = button);
    };
    make('pause', () => this.toggle());
    make('sound', () => {
      if (this.video) this.video.muted = !this.video.muted;
      this.update();
    }).hidden = !this.clip.hasAttribute('audio');
    // WCAG 2.2.2 lets only clips under 5 seconds drop the pause button.
    if (!/\bpause\b/.test(this.getAttribute('controls') ?? 'pause') && this.clips.every((c) => Number(c.getAttribute('duration')) < 5)) {
      this.buttons.pause.hidden = true;
    }

    this.userPaused = this.remembered;
    this.update();
    new IntersectionObserver(
      ([entry], observer) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        this.started = true;
        if (!this.userPaused) this.load();
      },
      { rootMargin: '200px' },
    ).observe(this);
    new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.intersectionRatio >= 0.1;
        this.sync();
      },
      { threshold: [0, 0.1] },
    ).observe(this);
    document.addEventListener('visibilitychange', () => this.sync());
  }

  private get clip() {
    return this.clips[0];
  }

  private get storageKey() {
    return `medkit-paused:${this.clip.getAttribute('src')}`;
  }

  private get remembered() {
    try {
      return sessionStorage.getItem(this.storageKey) === '1';
    } catch {
      return false;
    }
  }

  private remember(paused: boolean) {
    try {
      if (paused) sessionStorage.setItem(this.storageKey, '1');
      else sessionStorage.removeItem(this.storageKey);
    } catch {
      // Private browsing or blocked storage: the pause lasts until reload.
    }
  }

  /** Creates the video for the clip under its poster, and reveals it once a frame has painted. */
  private load() {
    const clip = this.clip;
    const video = document.createElement('video');
    const sources = JSON.parse(clip.getAttribute('sources') ?? '[]') as ClipSource[];
    const playable = sources.filter((s) => video.canPlayType(`video/mp4; codecs="${s.codec}"`));
    const av1 = playable.filter((s) => s.codec.startsWith('av01'));
    const list = (av1.length ? av1 : playable).filter((s) => Math.min(s.width, s.height) <= 1080).sort((a, b) => a.width - b.width);
    // The rendition must cover the box in both directions, because object-fit: cover crops.
    const [w, h] = [this.clientWidth * devicePixelRatio, this.clientHeight * devicePixelRatio];
    const pick = list.find((s) => s.width >= w && s.height >= h) ?? list.at(-1);
    if (!pick) return;

    const start = Number(clip.getAttribute('start')) || 0;
    video.muted = true;
    video.playsInline = true;
    video.loop = !start;
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    video.src = start ? `${pick.src}#t=${start}` : pick.src;
    // A start time replaces loop: the native loop would return to 0:00.
    if (start) video.onended = () => {
      video.currentTime = start;
      video.play().catch(() => {});
    };
    video.onplay = video.onpause = () => {
      this.update();
      this.dispatchEvent(new Event(video.paused ? 'medkit-pause' : 'medkit-play'));
    };
    const poster = clip.querySelector('picture');
    // Covered by the poster, the video still presents frames, so this fires
    // with a real frame on screen. A paused video presents its first frame
    // too, and the poster must stay when autoplay is refused, so a frame only
    // counts once playback has started.
    const reveal = () => {
      if (video.paused) return video.requestVideoFrameCallback(reveal);
      if (!poster) return;
      poster.style.transition = 'opacity .2s';
      poster.style.opacity = '0';
    };
    video.requestVideoFrameCallback(reveal);
    clip.prepend(video);
    this.video = video;
    this.sync();
  }

  /** Plays or pauses to match visibility and the visitor's choice. */
  private sync() {
    const video = this.video;
    if (!video) return;
    if (this.visible && !document.hidden && !this.userPaused) {
      // Autoplay can be refused (iOS Low Power Mode): the poster stays, and the
      // button offers play, because update() reads video.paused.
      video.play().catch(() => this.update());
    } else video.pause();
  }

  private toggle() {
    const paused = !this.video || this.video.paused;
    this.userPaused = !paused;
    this.remember(this.userPaused);
    if (paused && !this.video && this.started) this.load();
    this.sync();
    this.update();
  }

  private update() {
    const { pause, sound } = this.buttons;
    if (!pause) return;
    const playing = !!this.video && !this.video.paused;
    const muted = this.video?.muted ?? true;
    const set = (button: HTMLButtonElement, icon: keyof typeof ICONS, text: string) => {
      button.setAttribute('aria-label', text);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`;
    };
    set(pause, playing ? 'pause' : 'play', label(playing ? 'pause' : 'play'));
    set(sound, muted ? 'soundOff' : 'soundOn', label(muted ? 'soundOn' : 'soundOff'));
  }
}
