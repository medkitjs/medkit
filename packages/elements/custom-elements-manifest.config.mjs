export default {
  globs: ['src/image-element.ts', 'src/video-bg-element.ts', 'src/player-element.ts'],
  outdir: 'dist',
  // The build must not rewrite tracked files; "customElements" is set in package.json by hand.
  packagejson: false,
  plugins: [
    {
      // Private members are not API, and an event dispatched under a computed
      // name (`new Event(paused ? 'medkit-pause' : 'medkit-play')`) comes out
      // nameless; both are documented with @fires instead.
      name: 'medkit-public-only',
      packageLinkPhase({ customElementsManifest }) {
        for (const mod of customElementsManifest.modules) {
          for (const d of mod.declarations ?? []) {
            if (d.members) d.members = d.members.filter((m) => m.privacy !== 'private');
            if (d.events) d.events = d.events.filter((e) => e.name);
          }
        }
      },
    },
  ],
};
