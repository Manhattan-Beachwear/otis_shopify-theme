
// Resolve shared RX modules via the versioned import map (see
// snippets/rx-import-map.liquid) — unversioned relative imports would be
// CDN-cached for a year. The relative fallback covers node tests.
function rxImport(name) {
  let map = {};
  if (typeof document !== 'undefined') {
    try {
      map = JSON.parse(document.querySelector('script[data-rx-imports]')?.textContent ?? '{}');
    } catch {
      map = {};
    }
  }
  return import(map[name] ?? new URL(`./${name}`, import.meta.url).href);
}

const { RxState, lensColorSlug, stripImageSizeParams } = await rxImport('rx-core.js');
const { recolorLensImage } = await rxImport('rx-api.js');

// Shared singleton — the first RX component to initialize creates the state.
function getRxState() {
  window.rxState ??= new RxState();
  return window.rxState;
}

// Featured product image: the first gallery slide only — thumbnails, other
// slides and variant media stay untouched.
const MAIN_IMAGE_SELECTOR = '.product-information__media slideshow-slide img.product-media__image';

(function initRxRecolor() {
  if (window.__rxRecolorInit) return;
  window.__rxRecolorInit = true;

  const state = getRxState();
  // Original (non-recolored) featured image — the recolor source and the
  // restore target. srcset/sizes are kept so restore is lossless.
  let original = null;
  let setUrl = null;
  let reqId = 0;
  let debounceTimer = null;

  const mainImg = () => document.querySelector(MAIN_IMAGE_SELECTOR);

  // The recolor service downloads image_url itself, so it must be publicly
  // reachable — rewrite preview/localhost origins to the canonical shop domain.
  function publicImageUrl(src) {
    try {
      const u = new URL(src, location.href);
      const shop = window.Shopify?.shop;
      if (shop && u.pathname.startsWith('/cdn/')) return `https://${shop}${u.pathname}${u.search}`;
      return u.href;
    } catch {
      return src;
    }
  }

  function captureOriginal(el) {
    const src = el.currentSrc || el.src;
    if (!src || src === setUrl) return;
    original = {
      src: stripImageSizeParams(publicImageUrl(src)),
      srcset: el.getAttribute('srcset') || '',
      sizes: el.getAttribute('sizes') || '',
    };
  }

  function restore() {
    const el = mainImg();
    if (!el || !original) return;
    el.src = original.src;
    if (original.srcset) el.setAttribute('srcset', original.srcset);
    if (original.sizes) el.setAttribute('sizes', original.sizes);
    setUrl = null;
  }

  async function apply() {
    const el = mainImg();
    if (!el) return;
    if (!original) captureOriginal(el);
    if (!original) return;

    const color = state.lensProduct?.color;
    if (!color) return void restore();

    const my = ++reqId;
    el.classList.add('rx-recolor-loading');
    try {
      // Always recolor from the original source, never from a recolored image.
      const data = await recolorLensImage(original.src, lensColorSlug(color));
      if (my !== reqId) return;
      setUrl = data.url;
      // Kill the responsive set or the browser keeps showing the original.
      el.srcset = '';
      el.removeAttribute('sizes');
      el.src = data.url;
    } catch (error) {
      if (my === reqId) restore();
      console.warn('rx: recolor failed', error);
    } finally {
      if (my === reqId) mainImg()?.classList.remove('rx-recolor-loading');
    }
  }

  const scheduleApply = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(apply, 200);
  };

  state.addEventListener('rx:change', (event) => {
    if (event.detail?.key === 'lensProduct') scheduleApply();
  });

  // The gallery can re-render (variant change, section morph): a src we didn't
  // set means a new original — re-capture and re-apply the current color.
  const el = mainImg();
  if (el) {
    captureOriginal(el);
    new MutationObserver(() => {
      const current = mainImg();
      if (!current) return;
      const src = current.currentSrc || current.src;
      if (src && src !== setUrl && stripImageSizeParams(src) !== original?.src) {
        captureOriginal(current);
        if (state.lensProduct?.color) scheduleApply();
      }
    }).observe(el.closest('slideshow-slide') ?? el, { attributes: true, subtree: true, attributeFilter: ['src', 'srcset'] });
  }

  if (state.lensProduct?.color) scheduleApply();

  // Cache warming: quietly pre-generate every lens color for this frame so
  // swatch clicks resolve instantly. Results only land in the R2 cache.
  function warmCache() {
    if (!original) return;
    const dataEl = document.querySelector('[data-rx-product-data]');
    if (!dataEl) return;
    let colors = [];
    try {
      const data = JSON.parse(dataEl.textContent);
      colors = (data.lensCategories ?? [])
        .flatMap((category) => category.products ?? [])
        .map((product) => lensColorSlug(product.color))
        .filter(Boolean);
    } catch {
      return;
    }
    const queue = [...new Set(colors)].filter((slug) => slug !== lensColorSlug(state.lensProduct?.color));

    const next = async () => {
      const slug = queue.shift();
      if (!slug) return;
      await recolorLensImage(original.src, slug).catch(() => {});
      return next();
    };
    // Two lanes keep the service load modest.
    next();
    next();
  }

  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1));
  setTimeout(() => idle(warmCache), 4000);
})();
