
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
  const urlCache = new Map(); // color slug → generated image url (per page view)

  // Coatings are invisible on a photo: every Clear option shares one 'clear'
  // render instead of paying for three identical generations.
  const recolorSlug = (color) => {
    const slug = lensColorSlug(color);
    return slug.startsWith('clear') ? 'clear' : slug;
  };

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

  const generated = new Set(); // every url we ever set — never a recolor input

  // Only a Shopify-hosted product image counts as an original. Anything else
  // (our R2 renders included) must never become the recolor source, or each
  // result feeds the next request and the backend cache can never hit.
  function isShopImage(src) {
    try {
      return new URL(src, location.href).pathname.startsWith('/cdn/');
    } catch {
      return false;
    }
  }

  function captureOriginal(el) {
    const src = el.currentSrc || el.src;
    if (!src || src === setUrl || generated.has(src) || !isShopImage(src)) return;
    const normalized = stripImageSizeParams(publicImageUrl(src));
    if (original && normalized !== original.src) {
      // Different frame (combined-listing morph): its renders start over.
      urlCache.clear();
      setUrl = null;
    }
    original = {
      src: normalized,
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

  // Fetch the image off-screen first; resolves false on error or timeout so an
  // unreachable CDN (e.g. DNS failure) can never blank or hang the visible photo.
  function preloadImage(url, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const probe = new Image();
      const timer = setTimeout(() => {
        probe.src = '';
        resolve(false);
      }, timeoutMs);
      probe.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };
      probe.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      probe.src = url;
    });
  }

  async function apply() {
    const el = mainImg();
    if (!el) return;
    if (!original) captureOriginal(el);
    if (!original) return;

    const color = state.lensProduct?.color;
    if (!color) return void restore();

    const slug = recolorSlug(color);
    const my = ++reqId;
    el.classList.add('rx-recolor-loading');
    try {
      // Always recolor from the original source, never from a recolored image.
      let url = urlCache.get(slug);
      if (!url) {
        const data = await recolorLensImage(original.src, slug);
        if (my !== reqId) return;
        url = data.url;
        urlCache.set(slug, url);
        generated.add(url);
      }

      // Swap only once the render actually loaded; otherwise stay on the
      // original (and forget the url so a later attempt can retry).
      const loaded = await preloadImage(url);
      if (my !== reqId) return;
      if (!loaded) {
        urlCache.delete(slug);
        restore();
        return;
      }

      setUrl = url;
      // Kill the responsive set or the browser keeps showing the original.
      el.srcset = '';
      el.removeAttribute('sizes');
      el.src = url;
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

  // The gallery can re-render (variant change, combined-listing morph): a src
  // we didn't set means a new original — re-capture and re-apply the current
  // color. Observed on <main>: morphs replace the slide nodes, but <main> stays.
  const el = mainImg();
  if (el) captureOriginal(el);
  const mainEl = document.querySelector('main');
  if (mainEl) {
    const normalize = (src) => stripImageSizeParams(publicImageUrl(src));
    new MutationObserver(() => {
      const current = mainImg();
      if (!current) return;
      const src = current.currentSrc || current.src;
      if (!src || src === setUrl || generated.has(src)) return;
      if (normalize(src) === original?.src) {
        // The theme restored the original (e.g. re-applied srcset). Reassert
        // the recolored image from memory — no new request.
        if (setUrl && state.lensProduct?.color) {
          current.srcset = '';
          current.removeAttribute('sizes');
          current.src = setUrl;
        }
        return;
      }
      captureOriginal(current);
      if (state.lensProduct?.color) scheduleApply();
    }).observe(mainEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
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
        .map((product) => recolorSlug(product.color))
        .filter(Boolean);
    } catch {
      return;
    }
    const queue = [...new Set(colors)].filter(
      (slug) => slug !== recolorSlug(state.lensProduct?.color) && !urlCache.has(slug)
    );

    const next = async () => {
      const slug = queue.shift();
      if (!slug) return;
      await recolorLensImage(original.src, slug)
        .then((data) => {
          if (data?.url) {
            urlCache.set(slug, data.url);
            generated.add(data.url);
          }
        })
        .catch(() => {});
      return next();
    };
    // Two lanes keep the service load modest.
    next();
    next();
  }

  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1));
  setTimeout(() => idle(warmCache), 4000);
})();
