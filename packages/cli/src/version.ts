declare const __KC_VERSION__: string | undefined;

/** The release tag baked in at build time (bun build --define); `0.0.0-dev` when run from source. */
export const VERSION: string = typeof __KC_VERSION__ === "string" && __KC_VERSION__ !== "" ? __KC_VERSION__ : "0.0.0-dev";
