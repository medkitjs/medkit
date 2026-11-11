// The JSON Schema in dist/manifest.schema.json is generated from these types,
// and the JSDoc tags below (@pattern, @minimum, @maxLength, @asType) become its
// constraints. A constraint written anywhere else is not enforced.

/**
 * Path relative to `baseUrl`. No leading slash or backslash, no scheme, no
 * `..` segment, so a manifest can never point outside the media folder.
 * @pattern ^(?![/\\])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!(?:.+/)?\.\.(?:/|$))[^\\]+$
 */
export type RelativePath = string;

/** @pattern ^[A-Za-z0-9][A-Za-z0-9._-]*$ */
export type ManifestId = string;

/**
 * Blurred WebP as a data URI. Capped at 600 characters, because this string is
 * inlined into every page that shows the media.
 * @pattern ^data:image/webp;base64,[A-Za-z0-9+/]+=*$
 * @maxLength 600
 */
export type Placeholder = string;

/** @pattern ^#[0-9a-f]{6}$ */
export type HexColor = string;

/** @pattern ^[0-9a-f]+$ */
export type Hash = string;

/**
 * @asType integer
 * @minimum 1
 */
export type Pixels = number;

/**
 * @asType integer
 * @minimum 0
 */
export type Bytes = number;

export interface Rendition {
  src: RelativePath;
  width: Pixels;
  height: Pixels;
  bytes: Bytes;
}

export interface VideoRendition extends Rendition {
  /**
   * RFC 6381 codec string: H.264 (`avc1.…`) or AV1 (`av01.…`).
   * @pattern ^(avc1|av01)\.[0-9A-Za-z.]+$
   */
  codec: string;
}

/**
 * Format version. A reader that meets a version it does not know stops
 * rather than guessing.
 */
export type ManifestVersion = 1;

export interface ImageManifest {
  v: ManifestVersion;
  id: ManifestId;
  kind: 'image';
  width: Pixels;
  height: Pixels;
  /** Absent when no blur fits in 600 characters; readers fall back to `color`. */
  placeholder?: Placeholder;
  color: HexColor;
  /** @minItems 1 */
  avif: Rendition[];
  /** @minItems 1 */
  webp: Rendition[];
  /** @minItems 1 */
  jpeg: Rendition[];
  hash: Hash;
}

export interface VideoManifest {
  v: ManifestVersion;
  id: ManifestId;
  kind: 'video';
  width: Pixels;
  height: Pixels;
  /**
   * Seconds.
   * @exclusiveMinimum 0
   */
  duration: number;
  audio: boolean;
  poster: {
    /** Id of the poster's own image manifest. */
    id: ManifestId;
    placeholder: Placeholder;
    color: HexColor;
  };
  /** @minItems 1 */
  mp4: VideoRendition[];
  /** Master playlist; absent when the video was processed without HLS. */
  hls?: RelativePath;
  hash: Hash;
}

export type Manifest = ImageManifest | VideoManifest;
