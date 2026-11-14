import { pickRendition } from './rendition.js';
import { label as text, strings } from './strings.js';

/** One MP4 rendition, as renderVideoBg() writes it into a clip's `sources` attribute. */
export interface ClipSource {
  src: string;
  width: number;
  height: number;
  codec: string;
  /** Average bitrate. */
  kbps: number;
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
[role=status],.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media (forced-colors:active){button,span{border:1px solid ButtonText;background:ButtonFace;color:ButtonText}}`;

// Hides iOS's own start button on a video that has no controls; a shadow root
// cannot reach a light-DOM video's pseudo-elements, so this goes in the page once.
const PAGE_CSS = 'medkit-video-bg video::-webkit-media-controls-start-playback-button{display:none!important}';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

type Connection = { saveData?: boolean; effectiveType?: string; downlink?: number };
const connection = () => (navigator as Navigator & { connection?: Connection }).connection;

/**
 * Throughput in kbps from the first poster with a usable Resource Timing
 * entry. Time to first byte is left out, so latency does not read as low
 * bandwidth. A cached poster, or a cross-origin one without
 * Timing-Allow-Origin, reports 0 bytes and is skipped.
 */
function posterKbps(root: Element): number | undefined {
  for (const img of root.querySelectorAll('img')) {
    const t = performance.getEntriesByName(img.currentSrc)[0] as PerformanceResourceTiming | undefined;
    // Bytes × 8 per millisecond is kilobits per second.
    if (t?.encodedBodySize && t.responseEnd > t.responseStart) return (t.encodedBodySize * 8) / (t.responseEnd - t.responseStart);
  }
}

/**
 * A muted, looping background video that never shows a black frame, with an
 * optional playlist of `<medkit-clip>`s. Each clip's server-rendered poster
 * stays on top until its video has painted a frame during playback, then
 * fades out. Nothing loads until the element is within 200px of the viewport,
 * and no video at all with reduced motion, Save-Data or 2G. With `intro`, the
 * first poster waits in a `<noscript>`, shown only when no video will play.
 */
export class MedkitVideoBg extends HTMLElement {
  private clips: HTMLElement[] = [];
  private index = 0;
  private videos = new Map<HTMLElement, HTMLVideoElement>();
  private buttons: Record<string, HTMLButtonElement> = {};
  private position?: HTMLElement;
  private spoken?: HTMLElement;
  private status?: HTMLElement;
  /** Reduced motion, Save-Data or 2G: posters only. */
  private still = false;
  /** The visitor paused; only the visitor resumes. */
  private userPaused = false;
  /** At least 10% on screen and the tab visible. */
  private visible = true;
  private started = false;
  /** Videos buffered enough to play through; the poster covers the wait. */
  private ready = new WeakSet<HTMLVideoElement>();

  connectedCallback() {
    if (this.shadowRoot) return;
    this.clips = [...this.children].filter((c): c is HTMLElement => c.localName === 'medkit-clip');
    if (!this.clips.length) return;
    const net = connection();
    this.still = reducedMotion() || !!net?.saveData || /2g/.test(net?.effectiveType ?? '');
    const intro = this.getAttribute('intro');
    if (intro) this.style.background = intro;
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
      // Seen as "1 / 3", heard as "1 of 3".
      this.position = bar.appendChild(document.createElement('span'));
      this.position.setAttribute('aria-hidden', 'true');
      this.spoken = bar.appendChild(document.createElement('span'));
      this.spoken.className = 'sr';
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
    if (this.still) return this.showPoster();

    new IntersectionObserver(
      ([entry], observer) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        // The poster's own download is the throughput estimate, so the video
        // waits for it; a failed poster just starts without one.
        const begin = () => {
          this.started = true;
          if (!this.userPaused) this.sync();
        };
        const img = this.clip.querySelector('img');
        img && !img.complete ? img.decode().then(begin, begin) : begin();
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
    const downlink = connection()?.downlink;
    const pick = pickRendition(list, w, h, posterKbps(this), downlink && downlink * 1000);
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
    // Autoplay waits for canplaythrough or 3 seconds buffered ahead, so a slow
    // connection stalls on the poster, which is frame 0, instead of on a
    // frozen frame. iOS loads no further than metadata until play() is called,
    // and says so with suspend, which starts it; after 5 seconds it starts
    // regardless. A visitor's action skips all of this (sync). A stall later
    // (waiting) is left alone: the last frame stays, with no spinner.
    const go = () => {
      if (this.ready.has(video)) return;
      this.ready.add(video);
      this.sync();
    };
    video.oncanplaythrough = video.onsuspend = go;
    video.onprogress = video.oncanplay = () => {
      const { buffered: b } = video;
      if (b.length && b.end(b.length - 1) - video.currentTime >= Math.min(3, video.duration)) go();
    };
    setTimeout(go, 5000);
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
    // Without a poster (intro), the video itself starts hidden over the colour.
    if (!clip.querySelector('picture')) video.style.opacity = '0';
    // Covered by the poster, the video still presents frames, so this fires
    // with a real frame on screen. A paused video presents its first frame
    // too, and the poster must stay when autoplay is refused, so a frame only
    // counts once playback has started. The poster is looked up here, because
    // an intro clip's can appear after a refused autoplay; the video then
    // shows at once beneath it, so only one layer fades.
    const reveal = () => {
      if (video.paused) return video.requestVideoFrameCallback(reveal);
      const poster = clip.querySelector('picture');
      const cover = poster ?? video;
      if (poster) video.style.opacity = '';
      cover.style.transition = reducedMotion() ? '' : 'opacity .2s';
      cover.style.opacity = poster ? '0' : '1';
    };
    video.requestVideoFrameCallback(reveal);
    clip.prepend(video);
    this.videos.set(clip, video);
    // The button was drawn before this video existed, and would still offer play.
    this.update();
    return video;
  }

  /**
   * Plays the active clip, or pauses it, to match visibility and the visitor's
   * choice; every other clip pauses. `now` is a visitor's action: it plays at
   * once, without the start rule, and inside the tap, which iOS requires.
   */
  private sync(now?: boolean) {
    if (!this.started || this.still) return;
    for (const [clip, video] of this.videos) if (clip !== this.clip) video.pause();
    if (this.visible && !document.hidden && !this.userPaused) {
      // Autoplay can be refused (iOS Low Power Mode): the poster stays, and the
      // button offers play, because update() reads video.paused. A pause()
      // during play() rejects too, with AbortError, and must not show a poster.
      const video = this.load(this.clip);
      if (!video) this.showPoster();
      else {
        if (now) this.ready.add(video);
        if (this.ready.has(video))
          video.play().catch((e: DOMException) => {
            if (e.name === 'NotAllowedError') this.showPoster();
            this.update();
          });
      }
    } else this.video?.pause();
  }

  /**
   * An intro clip's poster, held back in a `<noscript>` until no video will
   * play. With scripting on, its content is text, so nothing was fetched. Only
   * the poster's own wrapper is searched: an overlay may have a noscript too.
   */
  private showPoster() {
    const held = this.clip.querySelector(':scope > div:first-of-type > noscript');
    if (held) held.outerHTML = held.textContent ?? '';
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
    // Only the clip's own fade counts: its poster's fade ends inside it and
    // bubbles up, and hiding the old clip then would show what is behind both.
    const settle = (event?: Event) => {
      if (event && event.target !== clip) return;
      clip.removeEventListener('transitionend', settle);
      previous.style.opacity = '0';
    };
    if (clip.style.transition) clip.addEventListener('transitionend', settle);
    else settle();
    previous.inert = true;
    clip.inert = false;

    const video = this.started && !this.still ? this.load(clip) : undefined;
    if (video) {
      video.currentTime = Number(clip.getAttribute('start')) || 0;
      video.muted = muted;
    }
    this.sync(manual);
    this.update();
    if (manual && this.status) {
      this.status.textContent = this.label('announce', { title: clip.getAttribute('title') ?? '', current: this.index + 1, total });
    }
    this.dispatchEvent(new CustomEvent('medkit-clipchange', { detail: { index: this.index, clip } }));
  }

  /** Playing, or waiting to buffer with nobody having paused it. */
  private get playing() {
    const video = this.video;
    return !!video && (!video.paused || (!this.ready.has(video) && !this.userPaused));
  }

  private toggle() {
    this.userPaused = this.playing;
    this.remember(this.userPaused);
    this.sync(true);
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

  private label(key: keyof typeof strings, values: Record<string, string | number> = {}) {
    return text(strings, key, values, this);
  }

  private update() {
    const { pause, sound, prev, next, expand } = this.buttons;
    const set = (button: HTMLButtonElement | undefined, icon: keyof typeof ICONS, text: string) => {
      if (!button) return;
      button.setAttribute('aria-label', text);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`;
    };
    const playing = this.playing;
    const muted = this.video?.muted ?? true;
    set(pause, playing ? 'pause' : 'play', this.label(playing ? 'pauseBackground' : 'playBackground'));
    set(sound, muted ? 'soundOff' : 'soundOn', this.label(muted ? 'soundOn' : 'soundOff'));
    if (sound) sound.hidden = !this.clip.hasAttribute('audio');
    const values = { current: this.index + 1, total: this.clips.length };
    set(expand, 'expand', this.label('expand'));
    set(prev, 'prev', this.label('prev'));
    set(next, 'next', this.label('next', values));
    if (this.position) {
      this.position.textContent = this.label('position', values);
      this.spoken!.textContent = this.label('spokenPosition', values);
    }
  }
}
