// CodeMirror measures text through Range rectangles, which jsdom does not implement.
if (typeof Range !== 'undefined') {
  const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() { return this } }
  Range.prototype.getClientRects ??= function getClientRects() { return Object.assign([], { item: () => null }) }
  Range.prototype.getBoundingClientRect ??= function getBoundingClientRect() { return emptyRect }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })
}
