// The Mapbox style every map uses (community, recap, and the feed's static images), so they all look the same.
// Birdseye's own style is built and uploaded by web/mapbox/build-style.mjs.
export const MAP_STYLE = 'd1birder/cmuikczu500de01s91vchgmsa' // "<username>/<style id>"; was mapbox/outdoors-v12
// Set by build-style.mjs --upload. Browsers and Mapbox's CDN keep a style ~30 min and a static image up to 12 h, so
// a new value in the URL is what makes an updated style show up right away.
export const MAP_STYLE_VERSION = '20260926155652'
export const MAP_STYLE_URL = `mapbox://styles/${MAP_STYLE}?v=${MAP_STYLE_VERSION}`
