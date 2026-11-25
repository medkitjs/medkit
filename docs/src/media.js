// Where processed media is served on this site: outDir is public/media, under
// the site's base path.
export const baseUrl = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}media/`;

// Where the element modules are served, for the preview frames, which load
// them as a page without a bundler would.
export const elementsUrl = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}medkit/`;
