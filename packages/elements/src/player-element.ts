import { registry } from './registry.js';
import { label as text } from './strings.js';

/**
 * Every visible and screen-reader label of <medkit-player>, in English. Keys
 * share one namespace with the background's table, because configure({ labels })
 * and registerLocale() take both.
 */
export const playerStrings = {
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  unmute: 'Unmute',
  volume: 'Volume',
  seek: 'Seek',
  /** What the seek bar reads as, such as "1:23 of 4:56". */
  seekValue: '{current} of {duration}',
  captions: 'Captions',
  captionsOff: 'Off',
  speed: 'Speed',
  pip: 'Picture in picture',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  /** The popup's thumbnail button; its visible duration must be part of its name. */
  openPopup: 'Play {title}, {duration}',
  /** A YouTube or Vimeo facade's play button. */
  playEmbed: 'Play {title}',
  closePopup: 'Close',
};

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zm6 0h4v14h-4z',
  mute: 'M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  unmute: 'M4 9v6h4l5 4V5L8 9zm16.6 6.2-1.4 1.4-2.7-2.7-2.7 2.7-1.4-1.4 2.7-2.7-2.7-2.7 1.4-1.4 2.7 2.7 2.7-2.7 1.4 1.4-2.7 2.7z',
  pip: 'M19 11h-8v6h8zm4 8V5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2m-2 0H3V5h18z',
  fullscreen: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z',
  exitFullscreen: 'M8 4h2v6H4V8h4zm6 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z',
  closePopup: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** The part of hls.js the player uses, so its types are not needed to build. */
interface Hls {
  new (config: { startPosition: number }): {
    on(event: string, listener: (event: string, data: { fatal: boolean }) => void): void;
    loadSource(url: string): void;
    attachMedia(media: HTMLMediaElement): void;
    destroy(): void;
  };
  isSupported(): boolean;
  Events: { ERROR: string };
}

/** One MP4 rendition, as renderPlayer() writes it into the `sources` attribute. */
interface Source {
  src: string;
  width: number;
  codec: string;
}

// The bar sits on a soft dark backdrop, so white icons keep 3:1 over any
// video; the focus ring is white on a black halo for the same reason.
const CSS = `:host{display:block;position:relative;color:#fff;font:14px/1.5 system-ui,sans-serif}
:host(:fullscreen),dialog:fullscreen{display:flex;align-items:center;background:#000}
::slotted(video){display:block;width:100%;height:auto}
:host(:fullscreen) ::slotted(video),dialog:fullscreen ::slotted(video){height:100%;max-height:none;object-fit:contain}
.thumb{position:relative;display:block;width:100%;height:auto;border-radius:var(--medkit-radius,4px);overflow:hidden;background:#000}
.thumb img{display:block;width:100%;height:100%;object-fit:cover}
.thumb ::slotted(picture){display:block}
iframe{display:block;width:100%;border:0}
.thumb svg{position:absolute;inset:50% auto auto 50%;width:64px;height:64px;padding:12px;margin:-44px;border-radius:50%;background:rgba(0,0,0,.6)}
.thumb span{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.75);border-radius:4px}
dialog{width:min(100vw - 32px,1280px);max-width:none;padding:0;border:0;background:#000;color:inherit;overflow:visible}
dialog::backdrop{background:rgba(0,0,0,.85)}
dialog ::slotted(video){max-height:calc(100vh - 32px);object-fit:contain}
.close{position:absolute;top:8px;right:8px;z-index:1;background:rgba(0,0,0,.6)}
[part=controls]{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 8px;background:rgba(0,0,0,.75);transition:opacity .2s}
:host(:not([audio])) [part=controls]{position:absolute;inset:auto 0 0;background:linear-gradient(transparent,rgba(0,0,0,.8) 40%)}
.idle{opacity:0;pointer-events:none}
button,select{all:unset;box-sizing:border-box;display:grid;place-items:center;min-width:var(--medkit-control-size,44px);height:var(--medkit-control-size,44px);border-radius:var(--medkit-radius,4px);cursor:pointer}
select{padding:0 8px}
option{color:#000}
input{flex:1;min-width:80px;height:var(--medkit-control-size,44px);margin:0;accent-color:var(--medkit-accent,#fff);cursor:pointer}
input+input,.vol{flex:0 1 80px}
:host([audio]) [part=controls]{flex-wrap:nowrap;overflow:hidden}
:host([audio]) input{min-width:0}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--medkit-accent,#fff);box-shadow:0 0 0 4px #000}
svg{width:24px;height:24px;fill:currentColor}
span{padding:0 4px;white-space:nowrap;font-variant-numeric:tabular-nums}
@media (forced-colors:active){[part=controls]{background:Canvas;color:CanvasText}button,select{border:1px solid ButtonText}}`;

// iOS draws its own start button over a video without controls; a shadow
// root cannot reach a light-DOM video's pseudo-elements, so this goes in the page.
const PAGE_CSS = 'medkit-player video::-webkit-media-controls-start-playback-button{display:none!important}';

/** Seconds as m:ss, or h:mm:ss from an hour. */
export const clock = (s: number) => {
  s = Math.floor(s || 0);
  const mmss = `${Math.floor(s / 60) % 60}:${String(s % 60).padStart(2, '0')}`;
  return s < 3600 ? mmss : `${Math.floor(s / 3600)}:${mmss.padStart(5, '0')}`;
};

/**
 * Replaces a native `<video>` or `<audio>`'s controls with one accessible
 * control bar and a keyboard map that applies only while focus is inside. The
 * media element plays on its own before this runs, and keeps playing if it
 * never does.
 */
export class MedkitPlayer extends HTMLElement {
  media!: HTMLMediaElement;
  private bar!: HTMLElement;
  private controls: Record<string, HTMLElement> = {};
  private idleTimer = 0;
  private tracks: TextTrack[] = [];
  /** The track C turns back on: the last one shown, else the first. */
  private lastTrack = 0;
  private prepared = false;
  private dialog?: HTMLDialogElement;
  private thumb?: HTMLButtonElement;
  private pageOverflow = '';
  /** Where focus returns when the popup closes: the thumbnail, or whatever opened it. */
  private opener?: HTMLElement;
  /** A facade's iframe, made when it opens. */
  private frame?: () => HTMLIFrameElement;

  connectedCallback() {
    if (this.shadowRoot) return;
    const provider = this.getAttribute('provider');
    if (provider) return this.facade(provider);
    const media = this.querySelector<HTMLMediaElement>('video, audio');
    if (!media) return;
    this.media = media;
    const audio = media.localName === 'audio';
    this.toggleAttribute('audio', audio);
    media.controls = false;
    if (!document.getElementById('medkit-player-css')) {
      document.head.insertAdjacentHTML('beforeend', `<style id="medkit-player-css">${PAGE_CSS}</style>`);
    }

    const root = this.attachShadow({ mode: 'open' });
    // In a popup the media and its bar move into a dialog, and a thumbnail of
    // the same shape takes their place, so the page does not move.
    const popup = this.hasAttribute('popup') && !audio;
    root.innerHTML = `<style>${CSS}</style>${
      popup
        ? `<button type="button" part="button" class="thumb"><img alt=""><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.play}"/></svg><span aria-hidden="true"></span></button><dialog><slot></slot><div part="controls"></div><button type="button" part="button" class="close"></button></dialog>`
        : '<slot></slot><div part="controls"></div>'
    }`;
    this.bar = root.querySelector('[part=controls]')!;
    if (popup) {
      const video = media as HTMLVideoElement;
      const thumb = (this.thumb = root.querySelector('.thumb')!);
      const dialog = (this.dialog = root.querySelector('dialog')!);
      thumb.style.aspectRatio = `${video.width || 16} / ${video.height || 9}`;
      thumb.querySelector('img')!.src = video.poster;
      thumb.onclick = () => this.open();
      const close = (this.controls.close = root.querySelector<HTMLButtonElement>('.close')!);
      close.onclick = () => dialog.close();
      // A click on the backdrop lands on the dialog itself, outside its content.
      dialog.onclick = (e) => e.target === dialog && dialog.close();
      dialog.onclose = () => this.closed();
    }
    const add = <K extends keyof HTMLElementTagNameMap>(name: string, tag: K, setup: (el: HTMLElementTagNameMap[K]) => void) => {
      const el = document.createElement(tag);
      el.setAttribute('part', tag === 'input' ? (name === 'seek' ? 'seek' : 'volume') : tag === 'select' ? 'menu' : 'button');
      if (tag === 'button') (el as HTMLButtonElement).type = 'button';
      setup(el);
      this.bar.append(el);
      this.controls[name] = el;
    };
    const range = (input: HTMLInputElement, max: number, onInput: () => void) => {
      Object.assign(input, { type: 'range', min: '0', max: String(max), step: 'any', oninput: onInput });
    };

    add('play', 'button', (b) => (b.onclick = () => this.toggle()));
    add('seek', 'input', (i) => range(i, 0, () => (media.currentTime = Number(i.value))));
    add('time', 'span', (s) => s.setAttribute('aria-hidden', 'true'));
    add('mute', 'button', (b) => (b.onclick = () => (media.muted = !media.muted)));
    add('volume', 'input', (i) => {
      range(i, 1, () => {
        media.volume = Number(i.value);
        media.muted = false;
      });
      i.className = 'vol';
      // iOS ignores volume set by a page; the hardware buttons are the control there.
      const before = media.volume;
      media.volume = before === 0.5 ? 0.4 : 0.5;
      i.hidden = media.volume === before;
      media.volume = before;
    });
    const tracks = (this.tracks = [...media.textTracks].filter((t) => t.kind === 'captions' || t.kind === 'subtitles'));
    add('captions', 'select', (s) => {
      s.hidden = !tracks.length;
      s.add(new Option('', '-1'));
      tracks.forEach((t, i) => s.add(new Option(t.label || t.language, String(i), false, t.mode === 'showing')));
      s.onchange = () => this.showCaptions(Number(s.value));
    });
    // A `default` track only becomes `showing` once its cues load; the menu follows.
    media.textTracks.addEventListener('change', () => {
      (this.controls.captions as HTMLSelectElement).value = String(tracks.findIndex((t) => t.mode === 'showing'));
    });
    add('speed', 'select', (s) => {
      for (const rate of SPEEDS) s.add(new Option(`${rate}×`, String(rate), false, rate === media.playbackRate));
      s.onchange = () => (media.playbackRate = Number(s.value));
    });
    if (!audio) {
      add('pip', 'button', (b) => {
        b.hidden = !document.pictureInPictureEnabled || (media as HTMLVideoElement).disablePictureInPicture;
        b.onclick = () =>
          document.pictureInPictureElement ? document.exitPictureInPicture() : (media as HTMLVideoElement).requestPictureInPicture().catch(() => {});
      });
      add('fullscreen', 'button', (b) => {
        const video = media as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
        // iPhone has no element fullscreen, only the video's own.
        b.hidden = !document.fullscreenEnabled && !video.webkitEnterFullscreen;
        b.onclick = () => this.fullscreen();
      });
      media.addEventListener('click', () => {
        this.toggle();
        this.focus({ preventScroll: true });
      });
    }

    // Keys work while focus is anywhere inside the player, including after a
    // click on the video, which focuses the player itself.
    this.tabIndex = -1;
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', this.getAttribute('title') || 'Player');
    this.addEventListener('keydown', (e) => this.key(e));
    media.addEventListener('play', () => this.wake());
    for (const type of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'ratechange']) {
      media.addEventListener(type, () => this.update());
    }
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin', 'focusout']) this.addEventListener(type, () => this.wake());
    document.addEventListener('fullscreenchange', () => this.update());
    this.update();
  }

  /**
   * YouTube or Vimeo: the server's link around the thumbnail becomes a play
   * button, and nothing loads from the provider until it is pressed, apart
   * from a preconnect on hover or focus. The iframe then takes the
   * thumbnail's box, or opens in the popup, with autoplay and focus inside.
   */
  private facade(provider: string) {
    const id = encodeURIComponent(this.getAttribute('video-id') || '');
    const src = provider === 'vimeo' ? `https://player.vimeo.com/video/${id}?autoplay=1` : `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1`;
    const origin = new URL(src).origin;
    const title = this.getAttribute('title') || '';
    const link = this.querySelector('a');
    link?.replaceWith(...link.childNodes);
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><button type="button" part="button" class="thumb"><slot></slot><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.play}"/></svg></button>${
      this.hasAttribute('popup') ? '<dialog><button type="button" part="button" class="close"></button></dialog>' : ''
    }`;
    const thumb = (this.thumb = root.querySelector('.thumb')!);
    thumb.setAttribute('aria-label', this.label('playEmbed', { title }));
    thumb.onpointerenter = thumb.onfocus = () => {
      if (!document.querySelector(`link[rel=preconnect][href="${origin}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'preconnect', href: origin }));
    };
    this.frame = () => {
      const frame = Object.assign(document.createElement('iframe'), { src, title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true });
      const { width, height } = thumb.getBoundingClientRect();
      frame.style.aspectRatio = `${width} / ${height}`;
      return frame;
    };
    const dialog = (this.dialog = root.querySelector('dialog') ?? undefined);
    if (!dialog) {
      thumb.onclick = () => {
        const frame = this.frame!();
        thumb.replaceWith(frame);
        frame.focus();
      };
      return;
    }
    thumb.onclick = () => this.open();
    const close = root.querySelector<HTMLButtonElement>('.close')!;
    close.setAttribute('aria-label', this.label('closePopup'));
    close.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.closePopup}"/></svg>`;
    close.onclick = () => dialog.close();
    dialog.onclick = (e) => e.target === dialog && dialog.close();
    dialog.onclose = () => this.closed();
  }

  private label(key: keyof typeof playerStrings, values: Record<string, string | number> = {}) {
    return text(playerStrings, key, values, this);
  }

  toggle() {
    const media = this.media;
    if (!media.paused) return media.pause();
    const play = () => media.play().catch(() => {});
    // play() stays inside the tap unless hls.js has to load first; iOS, which
    // counts only a play() inside the tap, plays HLS natively.
    const waiting = this.prepare();
    if (waiting) waiting.then(play);
    else play();
  }

  /**
   * Chooses what to play, once, at the first play: native HLS where the
   * browser has it (the first `<source>`), else HLS through a registered
   * hls.js, else the smallest MP4 that covers the player's width. Done at
   * play, not on connect, so a popup measures its dialog, not its thumbnail.
   */
  private prepare(): Promise<void> | void {
    const video = this.media;
    const hls = this.getAttribute('hls');
    if (this.prepared || video.localName !== 'video') return;
    this.prepared = true;
    const at = video.currentTime;
    if (hls && video.canPlayType('application/vnd.apple.mpegurl')) return;
    if (!hls || !registry.hls) return this.pickMp4(at);
    const fallback = (why: unknown) => {
      console.warn('medkit: HLS could not play; playing MP4 instead', why);
      this.pickMp4(video.currentTime || at);
    };
    return registry.hls().then((mod) => {
      const Hls = ((mod as { default?: Hls }).default ?? mod) as Hls;
      if (!Hls.isSupported()) return this.pickMp4(at);
      const player = new Hls({ startPosition: at });
      player.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        player.destroy();
        fallback(data);
        video.play().catch(() => {});
      });
      player.loadSource(hls);
      player.attachMedia(video);
    }, fallback);
  }

  private pickMp4(at: number) {
    const video = this.media;
    let sources: Source[] = [];
    try {
      sources = JSON.parse(this.getAttribute('sources') || '[]');
    } catch {
      console.warn('medkit: <medkit-player> sources is not JSON; playing the <source> list');
    }
    const playable = sources.filter((s) => video.canPlayType(`video/mp4; codecs="${s.codec}"`)).sort((a, b) => a.width - b.width);
    const need = this.clientWidth * devicePixelRatio;
    const pick = playable.find((s) => s.width >= need) ?? playable.at(-1);
    if (!pick) return;
    video.src = pick.src;
    video.currentTime = at;
  }

  private showCaptions(index: number) {
    this.tracks.forEach((t, i) => (t.mode = i === index ? 'showing' : 'disabled'));
    if (index >= 0) this.lastTrack = index;
    (this.controls.captions as HTMLSelectElement).value = String(index);
  }

  /**
   * Opens the popup and plays, from `at` seconds when given; focus returns to
   * `opener` on close, the thumbnail by default. A popup's thumbnail calls
   * this; so does a background's expand.
   */
  open(at?: number, opener?: HTMLElement) {
    const { dialog, media } = this;
    if (!dialog || dialog.open) return;
    this.opener = opener;
    const frame = this.frame?.();
    if (frame) dialog.prepend(frame);
    else if (at !== undefined) media.currentTime = at;
    dialog.setAttribute('aria-label', this.getAttribute('title') || '');
    dialog.showModal();
    // The page behind stays where it is while the popup is open.
    this.pageOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    if (frame) frame.focus();
    else {
      if (media.paused) this.toggle();
      this.controls.play.focus();
    }
    this.dispatchEvent(new CustomEvent('medkit-popupopen'));
  }

  /** Closes the popup: Esc, the close button and a click on the backdrop all come here. */
  close() {
    this.dialog?.close();
  }

  private closed() {
    // A facade's iframe is removed, which is the only way to stop it.
    if (this.frame) this.dialog!.querySelector('iframe')?.remove();
    else this.media.pause();
    document.documentElement.style.overflow = this.pageOverflow;
    if (document.fullscreenElement === this.dialog) document.exitFullscreen();
    (this.opener ?? this.thumb!).focus();
    this.dispatchEvent(new CustomEvent('medkit-popupclose', { detail: { currentTime: this.media?.currentTime } }));
  }

  private fullscreen() {
    const video = this.media as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.fullscreenEnabled) (this.dialog?.open ? this.dialog : this).requestFullscreen().catch(() => {});
    else video.webkitEnterFullscreen?.();
  }

  /** The media's duration, or the manifest's until its metadata has loaded (`preload="none"`). */
  private get duration() {
    return this.media.duration || Number(this.getAttribute('duration')) || 0;
  }

  private seek(to: number) {
    this.media.currentTime = Math.min(Math.max(0, to), this.duration);
    // Paused before its metadata loads, the media fires no timeupdate.
    this.update();
  }

  private key(e: KeyboardEvent) {
    const media = this.media;
    // A closed popup's media is not on screen; its thumbnail is just a button.
    if (this.dialog && !this.dialog.open) return;
    const target = e.composedPath()[0] as HTMLElement;
    const owns = target.localName;
    // A focused control keeps the keys it already handles: Space and Enter on
    // a button, everything on a menu, arrows on the volume slider.
    if (owns === 'select' && e.key !== 'Escape') return;
    if (owns === 'button' && (e.key === ' ' || e.key === 'Enter')) return;
    if (target === this.controls.volume && e.key.startsWith('Arrow')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const t = media.currentTime;
    const volume = (by: number) => {
      media.volume = Math.round(Math.min(1, Math.max(0, media.volume + by)) * 100) / 100;
      media.muted = false;
    };
    const rate = (by: number) => {
      media.playbackRate = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(media.playbackRate) + by))] ?? 1;
    };
    const actions: Record<string, () => void> = {
      ' ': () => this.toggle(),
      k: () => this.toggle(),
      ArrowLeft: () => this.seek(t - 5),
      ArrowRight: () => this.seek(t + 5),
      j: () => this.seek(t - 10),
      l: () => this.seek(t + 10),
      ArrowUp: () => volume(0.05),
      ArrowDown: () => volume(-0.05),
      m: () => (media.muted = !media.muted),
      c: () => this.tracks.length && this.showCaptions(this.tracks.some((tr) => tr.mode === 'showing') ? -1 : this.lastTrack),
      f: () => !this.controls.fullscreen?.hidden && this.fullscreen(),
      '<': () => rate(-1),
      '>': () => rate(1),
      Home: () => this.seek(0),
      End: () => this.seek(this.duration),
    };
    const action = /^[0-9]$/.test(k) ? () => this.seek((this.duration * Number(k)) / 10) : actions[k];
    if (!action) return;
    e.preventDefault();
    action();
  }

  /** Shows the bar, and hides it again after 2.5 s of playback without interaction. */
  private wake() {
    this.bar.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      const media = this.media;
      // Never while paused, in audio mode, or with focus in the bar or a menu.
      if (!media.paused && !this.hasAttribute('audio') && !this.bar.contains(this.shadowRoot!.activeElement)) this.bar.classList.add('idle');
    }, 2500);
  }

  private update() {
    const media = this.media;
    const c = this.controls;
    const icon = (name: string, key: keyof typeof playerStrings & keyof typeof ICONS) => {
      const button = c[name];
      if (!button) return;
      button.setAttribute('aria-label', this.label(key));
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[key]}"/></svg>`;
    };
    icon('play', media.paused ? 'play' : 'pause');
    icon('mute', media.muted || !media.volume ? 'unmute' : 'mute');
    icon('pip', 'pip');
    icon('fullscreen', document.fullscreenElement ? 'exitFullscreen' : 'fullscreen');
    if (this.thumb) {
      this.thumb.setAttribute('aria-label', this.label('openPopup', { title: this.getAttribute('title') || '', duration: clock(this.duration) }));
      this.thumb.lastElementChild!.textContent = clock(this.duration);
      icon('close', 'closePopup');
    }
    const duration = this.duration;
    const seek = c.seek as HTMLInputElement;
    seek.max = String(duration);
    seek.value = String(media.currentTime);
    seek.setAttribute('aria-label', this.label('seek'));
    seek.setAttribute('aria-valuetext', this.label('seekValue', { current: clock(media.currentTime), duration: clock(duration) }));
    c.time.textContent = `${clock(media.currentTime)} / ${clock(duration)}`;
    const volume = c.volume as HTMLInputElement;
    volume.value = String(media.muted ? 0 : media.volume);
    volume.setAttribute('aria-label', this.label('volume'));
    const captions = c.captions as HTMLSelectElement;
    captions.setAttribute('aria-label', this.label('captions'));
    captions.options[0].text = this.label('captionsOff');
    const speed = c.speed as HTMLSelectElement;
    speed.setAttribute('aria-label', this.label('speed'));
    speed.value = String(media.playbackRate);
    if (media.paused) this.bar.classList.remove('idle');
  }
}
