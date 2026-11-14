// A debug panel for the medkit-video-bg and medkit-player fixture pages, for
// checks on a real phone: add ?debug to a page's URL. The pages
// tests/e2e/setup.ts writes load it; it is a fixture tool, in no published
// package. It shows each background's chosen rendition, poster estimate,
// readyState and buffer, each player's source and the fullscreen and
// picture-in-picture paths the device offers, and a timestamped log of media
// events, play() rejections, popups, and the likely reason for each pause or
// resume; Copy puts it all on the clipboard. It watches from
// outside the element and never changes what it does, except that play() is
// wrapped to log its rejections, which the element catches. Without ?debug it
// does nothing at all.

if (new URLSearchParams(location.search).has('debug')) {
  const MAX = 400;
  const log = [];
  const stamp = () => (performance.now() / 1000).toFixed(3).padStart(8);
  const base = (url) => (url ? url.split('/').pop() : '(none)');
  // A popup that a background's expand made sits in <body>: named by its title.
  const hostId = (el) => {
    const host = el.closest('medkit-video-bg, medkit-player');
    return host?.parentElement?.id || (host ? `${host.localName} "${host.getAttribute('title')}"` : '?');
  };
  const who = (v) => `${hostId(v)}/${v.closest('medkit-clip')?.getAttribute('src') ?? v.localName}`;
  // The element's own measure: the end of the last buffered range past the current time.
  const ahead = (v) => {
    const b = v.buffered;
    return b.length ? (b.end(b.length - 1) - v.currentTime).toFixed(1) : '0';
  };
  const state = (v) => `rs=${v.readyState} t=${v.currentTime.toFixed(2)} ahead=${ahead(v)}s`;
  const add = (from, text) => {
    log.push(`${stamp()}  ${from}  ${text}`);
    if (log.length > MAX) log.shift();
  };

  // The element catches play() rejections (refused autoplay), so log them here.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const p = play.call(this);
    p.catch((e) => add(who(this), `play() rejected: ${e.name}: ${e.message}`));
    return p;
  };

  // What could explain a pause or a resume, newest first.
  const ratios = new Map();
  let lastClick = { at: -1e9, label: '' };
  let lastClipChange = -1e9;
  const reason = (v, resuming) => {
    const now = performance.now();
    const ratio = ratios.get(v.closest('medkit-video-bg'));
    if (now - lastClick.at < 1000) return `button "${lastClick.label}"`;
    if (now - lastClipChange < 1000) return 'clip change';
    if (!resuming && v.ended) return 'ended';
    if (document.hidden) return 'tab hidden';
    if (ratio !== undefined && ratio < 0.1) return `${Math.round(ratio * 100)}% visible (< 10%)`;
    if (resuming) return `tab visible, ${ratio === undefined ? '?' : Math.round(ratio * 100)}% visible`;
    return 'unknown (system? Low Power Mode? another media session?)';
  };

  const EVENTS = ['loadstart', 'loadedmetadata', 'loadeddata', 'suspend', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error'];
  // progress fires often; logged only when the buffered end moves by 0.5 s or more.
  const lastEnd = new WeakMap();
  document.addEventListener(
    'progress',
    (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement)) return;
      const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
      if (lastEnd.has(v) && Math.abs(end - lastEnd.get(v)) < 0.5) return;
      lastEnd.set(v, end);
      add(who(v), `progress ${state(v)} buffered to ${end.toFixed(1)}s`);
    },
    true,
  );
  for (const type of EVENTS) {
    document.addEventListener(
      type,
      (e) => {
        const v = e.target;
        if (!(v instanceof HTMLVideoElement)) return;
        let extra = '';
        if (type === 'pause') extra = ` — reason: ${reason(v, false)}`;
        if (type === 'play') extra = ` — reason: ${reason(v, true)}`;
        if (type === 'error') extra = ` — ${v.error?.code}: ${v.error?.message}`;
        add(who(v), `${type} ${state(v)}${extra}`);
      },
      true,
    );
  }
  document.addEventListener('visibilitychange', () => add('page', document.hidden ? 'tab hidden' : 'tab visible'));
  document.addEventListener(
    'click',
    (e) => {
      const button = e.composedPath().find((n) => n instanceof HTMLElement && n.localName === 'button');
      if (button) {
        lastClick = { at: performance.now(), label: button.getAttribute('aria-label') ?? '' };
        add(hostId(e.target), `click "${lastClick.label}"`);
      }
    },
    true,
  );
  document.addEventListener('medkit-clipchange', (e) => {
    lastClipChange = performance.now();
    add(hostId(e.target), `clipchange to ${e.detail.index + 1}`);
  }, true);
  for (const type of ['medkit-play', 'medkit-pause', 'medkit-expand', 'medkit-popupopen', 'medkit-popupclose', 'fullscreenchange', 'enterpictureinpicture', 'leavepictureinpicture', 'webkitbeginfullscreen', 'webkitendfullscreen']) {
    document.addEventListener(type, (e) => add(e.target === document ? `fullscreen ${document.fullscreenElement?.localName ?? 'none'}` : hostId(e.target), type), true);
  }

  const watchVideo = (v) => {
    add(who(v), `video created, rendition ${base(v.src)}`);
    v.requestVideoFrameCallback((_, m) => add(who(v), `first frame presented (mediaTime ${m.mediaTime.toFixed(3)}, ${m.width}×${m.height})`));
    const playing = () =>
      v.requestVideoFrameCallback((_, m) => (v.paused ? playing() : add(who(v), `first playing frame (mediaTime ${m.mediaTime.toFixed(3)})`)));
    playing();
  };
  const watchHost = (host) => {
    new IntersectionObserver(
      ([entry]) => {
        const before = ratios.get(host);
        ratios.set(host, entry.intersectionRatio);
        if (before === undefined || before >= 0.1 !== entry.intersectionRatio >= 0.1) add(hostId(host), `${Math.round(entry.intersectionRatio * 100)}% visible`);
      },
      { threshold: [0, 0.1, 0.5, 1] },
    ).observe(host);
  };
  const scan = (root) => {
    if (!(root instanceof Element)) return;
    if (root.localName === 'video' && root.closest('medkit-video-bg')) watchVideo(root);
    if (root.localName === 'picture' && root.closest('medkit-clip') && document.readyState !== 'loading') add(hostId(root), 'poster shown (intro noscript parsed)');
    for (const v of root.querySelectorAll('medkit-video-bg video')) watchVideo(v);
    for (const p of root.localName === 'medkit-player' ? [root] : root.querySelectorAll('medkit-player')) add(hostId(p), `player ${p.getAttribute('provider') ?? 'media'}${p.hasAttribute('popup') ? ', popup' : ''}`);
  };
  for (const host of document.querySelectorAll('medkit-video-bg')) {
    watchHost(host);
    // The element's own key: a visitor's pause, remembered for the tab's session.
    let paused = false;
    try {
      paused = sessionStorage.getItem(`medkit-paused:${host.querySelector('medkit-clip')?.getAttribute('src')}`) === '1';
    } catch {}
    if (paused) add(hostId(host), 'skipped: paused earlier this session (no video until Play)');
  }
  const faded = new WeakSet();
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) scan(n);
      const t = r.target;
      if (r.type !== 'attributes' || faded.has(t)) continue;
      if (t.localName === 'picture' && t.style.opacity === '0') add(hostId(t), 'poster fade starts');
      else if (t.localName === 'video' && t.style.opacity === '1' && (r.oldValue ?? '').includes('opacity: 0')) add(who(t), 'video fade-in starts (intro)');
      else continue;
      faded.add(t);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });

  /** The element's poster estimate: the first poster with a usable Resource Timing entry. */
  const posterKbps = (host) => {
    for (const img of host.querySelectorAll('img')) {
      const t = performance.getEntriesByName(img.currentSrc)[0];
      if (t?.encodedBodySize && t.responseEnd > t.responseStart) {
        const ms = t.responseEnd - t.responseStart;
        return `${Math.round((t.encodedBodySize * 8) / ms)} kbps (${base(img.currentSrc)}, ${t.encodedBodySize} B in ${ms.toFixed(0)} ms, TTFB ${(t.responseStart - t.requestStart).toFixed(0)} ms)`;
      }
      if (t) return `n/a (${base(img.currentSrc)}: encodedBodySize ${t.encodedBodySize}, cached or not exposed)`;
    }
    return 'n/a (no poster loaded)';
  };
  const status = () => {
    const c = navigator.connection;
    const lines = [
      `${navigator.userAgent.replace(/^.*?\(/, '(').slice(0, 90)}`,
      `dpr ${devicePixelRatio}  viewport ${innerWidth}×${innerHeight}  reduced motion ${matchMedia('(prefers-reduced-motion: reduce)').matches}  ` +
        (c ? `downlink ${c.downlink} Mbps  type ${c.effectiveType}  saveData ${c.saveData}` : 'navigator.connection: none'),
    ];
    const anyVideo = document.createElement('video');
    lines.push(
      `native HLS ${anyVideo.canPlayType('application/vnd.apple.mpegurl') || 'no'}  element fullscreen ${document.fullscreenEnabled}  video fullscreen ${'webkitEnterFullscreen' in anyVideo}  PiP ${document.pictureInPictureEnabled}`,
    );
    for (const p of document.querySelectorAll('medkit-player')) {
      const m = p.querySelector('video, audio');
      lines.push('', `${hostId(p)}  box ${p.clientWidth}×${p.clientHeight}  hls ${base(p.getAttribute('hls')) ?? '-'}`);
      if (m) lines.push(`  ${base(m.currentSrc)} ${m.videoWidth ?? ''}×${m.videoHeight ?? ''}  ${state(m)}  paused ${m.paused}  muted ${m.muted}  volume ${m.volume}  rate ${m.playbackRate}`);
    }
    for (const host of document.querySelectorAll('medkit-video-bg')) {
      const r = ratios.get(host);
      lines.push('', `#${hostId(host)}  box ${host.clientWidth}×${host.clientHeight} (×dpr ${Math.round(host.clientWidth * devicePixelRatio)}×${Math.round(host.clientHeight * devicePixelRatio)})  ${r === undefined ? '' : Math.round(r * 100) + '% visible'}`);
      lines.push(`  poster estimate: ${posterKbps(host)}`);
      host.querySelectorAll('medkit-clip').forEach((clip, i) => {
        const v = clip.querySelector('video');
        const rungs = JSON.parse(clip.getAttribute('sources') ?? '[]').map((s) => `${s.height}p ${s.codec.slice(0, 4)} ${s.kbps}k${v && v.src === s.src ? ' ◀' : ''}`);
        lines.push(`  clip ${i + 1} ${clip.getAttribute('src')}${clip.inert ? '' : ' (active)'}: ${rungs.join(' | ')}`);
        if (v) lines.push(`    ${base(v.currentSrc)} ${v.videoWidth}×${v.videoHeight}  ${state(v)}  paused ${v.paused}  net ${v.networkState}  buffered ${[...Array(v.buffered.length)].map((_, i) => `${v.buffered.start(i).toFixed(1)}–${v.buffered.end(i).toFixed(1)}`).join(',') || 'none'}  opacity ${getComputedStyle(clip.querySelector('picture') ?? v).opacity}`);
      });
    }
    return lines.join('\n');
  };

  const panel = document.createElement('div');
  panel.setAttribute('aria-hidden', 'true');
  panel.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:45vh;overflow:auto;background:rgba(0,0,0,.88);color:#fff;font:10px/1.35 ui-monospace,Menlo,monospace;padding:6px;-webkit-text-size-adjust:none';
  panel.innerHTML =
    '<div style="display:flex;gap:6px;margin-bottom:4px"><button data-a="copy">Copy</button><button data-a="toggle">Collapse</button><button data-a="clear">Clear log</button></div><pre style="margin:0;white-space:pre-wrap"></pre>';
  const pre = panel.querySelector('pre');
  let collapsed = false;
  panel.addEventListener('click', async (e) => {
    const a = e.target.dataset?.a;
    if (a === 'toggle') {
      collapsed = !collapsed;
      e.target.textContent = collapsed ? 'Expand' : 'Collapse';
    }
    if (a === 'clear') log.length = 0;
    if (a === 'copy') {
      const text = `${location.href}\n${status()}\n\n${log.join('\n')}`;
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = 'Copied';
      } catch {
        const area = Object.assign(document.createElement('textarea'), { value: text });
        panel.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        e.target.textContent = 'Copied (fallback)';
      }
      setTimeout(() => (e.target.textContent = 'Copy'), 1500);
    }
    e.stopPropagation();
  });
  setInterval(() => {
    pre.textContent = collapsed ? log.slice(-3).join('\n') : `${status()}\n\n${log.slice().reverse().join('\n')}`;
  }, 250);
  // Room below the page as tall as the panel, so the last background's buttons can scroll above it.
  const mount = () => {
    document.body.append(panel);
    new ResizeObserver(() => (document.body.style.paddingBottom = `${panel.offsetHeight}px`)).observe(panel);
  };
  document.body ? mount() : addEventListener('DOMContentLoaded', mount);
  add('page', `debug panel on, ${document.readyState}`);
}
