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
  prev: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z',
  next: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
  expand: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z',
};

// The white icon sits on 60% black: at least 5.7:1 over a white frame, and the
// focus ring is white on a black halo, so both keep 3:1 over any video.
const CSS = `:host{display:block;position:relative;overflow:hidden}
[part=controls]{position:absolute;z-index:2;right:var(--medkit-controls-inset,16px);bottom:var(--medkit-controls-inset,16px);display:flex;align-items:center;gap:8px;color:#fff}
button{all:unset;box-sizing:border-box;display:grid;place-items:center;width:var(--medkit-control-size,44px);height:var(--medkit-control-size,44px);border-radius:50%;background:rgba(0,0,0,.6);cursor:pointer}
[hidden]{display:none!important}
button:focus-visible{outline:2px solid var(--medkit-accent,#fff);box-shadow:0 0 0 4px #000}
svg{width:24px;height:24px;fill:currentColor}
span{padding:2px 8px;border-radius:12px;background:rgba(0,0,0,.6);font:14px/1.5 system-ui,sans-serif}
[role=status]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media (forced-colors:active){button,span{border:1px solid ButtonText;background:ButtonFace;color:ButtonText}}`;

// Hides iOS's own start button on a video that has no controls; a shadow root
// cannot reach a light-DOM video's pseudo-elements, so this goes in the page once.
const PAGE_CSS = 'medkit-video-bg video::-webkit-media-controls-start-playback-button{display:none!important}';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A muted, looping background video that never shows a black frame, with an
 * optional playlist of `<medkit-clip>`s. Each clip's server-rendered poster
 * stays on top until its video has painted a frame during playback, then
 * fades out. Nothing loads until the element is within 200px of the viewport,
 * and no video at all with reduced motion, Save-Data or 2G.
 */
export class MedkitVideoBg extends HTMLElement {
  private clips: HTMLElement[] = [];
  private index = 0;
  private videos = new Map<HTMLElement, HTMLVideoElement>();
  private buttons: Record<string, HTMLButtonElement> = {};
  private position?: HTMLElement;
  private status?: HTMLElement;
  /** Reduced motion, Save-Data or 2G: posters only. */
  private still = false;
  /** The visitor paused; only the visitor resumes. */
  private userPaused = false;
  /** At least 10% on screen and the tab visible. */
  private visible = true;
  private started = false;

  connectedCallback() {
    if (this.shadowRoot) return;
    this.clips = [...this.children].filter((c): c is HTMLElement => c.localName === 'medkit-clip');
    if (!this.clips.length) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    this.still = reducedMotion() || !!connection?.saveData || /2g/.test(connection?.effectiveType ?? '');
    const controls = (this.getAttribute('controls') ?? 'pause').split(/\s+/);

    if (!document.getElementById('medkit-video-bg-css')) {
      document.head.insertAdjacentHTML('beforeend', `<style id="medkit-video-bg-css">${PAGE_CSS}</style>`);
    }
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><slot></slot><div part="controls"></div><div role="status"></div>`;
    const bar = root.children[2];
    this.status = root.children[3] as HTMLElement;
    const make = (name: string, onClick: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('part', 'button');
      button.onclick = onClick;
      bar.append(button);
      return (this.buttons[name] = button);
    };
    if (this.clips.length > 1 && controls.includes('nav')) {
      make('prev', () => this.go(this.index - 1, true));
      this.position = bar.appendChild(document.createElement('span'));
      make('next', () => this.go(this.index + 1, true));
    }
    // Without a video there is nothing to pause or hear.
    if (!this.still) {
      make('pause', () => this.toggle());
      // WCAG 2.2.2 lets only clips under 5 seconds drop the pause button.
      this.buttons.pause.hidden = !controls.includes('pause') && this.clips.every((c) => Number(c.getAttribute('duration')) < 5);
      if (controls.includes('sound')) make('sound', () => this.toggleSound());
      if (controls.includes('expand')) make('expand', () => this.expand());
    }

    // The server shows only the first clip; from here, inactive clips are
    // rendered for the crossfade but hidden from keyboard and screen readers.
    this.clips.forEach((clip, i) => {
      clip.hidden = false;
      clip.inert = i > 0;
      clip.style.opacity = i ? '0' : '1';
    });
    this.userPaused = this.remembered;
    this.update();
    if (this.still) return;

    new IntersectionObserver(
      ([entry], observer) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        this.started = true;
        if (!this.userPaused) this.sync();
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
    return this.clips[this.index];
  }

  private get video() {
    return this.videos.get(this.clip);
  }

  private get autoadvance() {
    return this.hasAttribute('autoadvance') && this.clips.length > 1;
  }

  private get storageKey() {
    return `medkit-paused:${this.clips[0].getAttribute('src')}`;
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

  /** The clip's video, created under its poster on first use. */
  private load(clip: HTMLElement): HTMLVideoElement | undefined {
    const existing = this.videos.get(clip);
    if (existing) return existing;
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
    // A start time or auto-advance replaces loop: the native loop returns to
    // 0:00 and never ends.
    video.loop = !start && !this.autoadvance;
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.preload = 'auto';
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    video.src = start ? `${pick.src}#t=${start}` : pick.src;
    video.onended = () => {
      if (this.autoadvance) return this.go(this.index + 1, false);
      video.currentTime = start;
      video.play().catch(() => {});
    };
    video.onplay = video.onpause = () => {
      if (video !== this.video) return;
      this.update();
      this.dispatchEvent(new Event(video.paused ? 'medkit-pause' : 'medkit-play'));
    };
    // At 75%, the next clip's poster and first seconds start loading.
    video.ontimeupdate = () => {
      if (video === this.video && this.clips.length > 1 && video.currentTime > video.duration * 0.75) {
        const next = this.clips[(this.index + 1) % this.clips.length];
        next.querySelector('img')?.setAttribute('loading', 'eager');
        this.load(next);
      }
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
    this.videos.set(clip, video);
    return video;
  }

  /** Plays the active clip, or pauses it, to match visibility and the visitor's choice; every other clip pauses. */
  private sync() {
    if (!this.started || this.still) return;
    for (const [clip, video] of this.videos) if (clip !== this.clip) video.pause();
    if (this.visible && !document.hidden && !this.userPaused) {
      // Autoplay can be refused (iOS Low Power Mode): the poster stays, and the
      // button offers play, because update() reads video.paused.
      this.load(this.clip)?.play().catch(() => this.update());
    } else this.video?.pause();
  }

  /** Shows clip `n`; `manual` is a visitor's press, the only change that is announced. */
  private go(n: number, manual: boolean) {
    const total = this.clips.length;
    const previous = this.clip;
    const muted = this.video?.muted ?? true;
    this.index = (n + total) % total;
    const clip = this.clip;
    // The new clip fades in on top while the old one stays opaque beneath it,
    // so the two never blend into a darker frame.
    clip.style.transition = reducedMotion() ? '' : 'opacity .4s';
    clip.style.zIndex = '1';
    previous.style.zIndex = '';
    clip.style.opacity = '1';
    const settle = () => (previous.style.opacity = '0');
    if (clip.style.transition) clip.addEventListener('transitionend', settle, { once: true });
    else settle();
    previous.inert = true;
    clip.inert = false;

    const video = this.started && !this.still ? this.load(clip) : undefined;
    if (video) {
      video.currentTime = Number(clip.getAttribute('start')) || 0;
      video.muted = muted;
    }
    this.sync();
    this.update();
    if (manual && this.status) {
      this.status.textContent = label('announce', { title: clip.getAttribute('title') ?? '', current: this.index + 1, total });
    }
    this.dispatchEvent(new CustomEvent('medkit-clipchange', { detail: { index: this.index, clip } }));
  }

  private toggle() {
    const paused = !this.video || this.video.paused;
    this.userPaused = !paused;
    this.remember(this.userPaused);
    this.sync();
    this.update();
  }

  /**
   * Hands the clip over to a player: pauses the background as if the visitor
   * had (without remembering it), and tells the page which clip and where.
   * Opening the popup and resuming afterwards come with <medkit-player>.
   */
  private expand() {
    const video = this.video;
    this.userPaused = true;
    this.sync();
    this.update();
    this.dispatchEvent(
      new CustomEvent('medkit-expand', {
        detail: { index: this.index, clip: this.clip, src: this.clip.getAttribute('src'), currentTime: video?.currentTime ?? 0 },
      }),
    );
  }

  private toggleSound() {
    const video = this.video;
    if (video) video.muted = !video.muted;
    this.update();
  }

  private update() {
    const { pause, sound, prev, next, expand } = this.buttons;
    const set = (button: HTMLButtonElement | undefined, icon: keyof typeof ICONS, text: string) => {
      if (!button) return;
      button.setAttribute('aria-label', text);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`;
    };
    const playing = !!this.video && !this.video.paused;
    const muted = this.video?.muted ?? true;
    set(pause, playing ? 'pause' : 'play', label(playing ? 'pause' : 'play'));
    set(sound, muted ? 'soundOff' : 'soundOn', label(muted ? 'soundOn' : 'soundOff'));
    if (sound) sound.hidden = !this.clip.hasAttribute('audio');
    const values = { current: this.index + 1, total: this.clips.length };
    set(expand, 'expand', label('expand'));
    set(prev, 'prev', label('prev'));
    set(next, 'next', label('next', values));
    if (this.position) this.position.textContent = label('position', values);
  }
}
