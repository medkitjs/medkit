// Astro types .astro imports through its editor plugin, not through tsc, so
// `pnpm lint` needs this declaration to type-check astro.test.ts.
declare module '*.astro' {
  const component: import('astro/runtime/server/index.js').AstroComponentFactory;
  export default component;
}
