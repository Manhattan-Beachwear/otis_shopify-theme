/**
 * RX bundle add-to-cart.
 *
 * `addRxBundle` is a pure fetch helper (no @theme imports) so it can run under
 * `node --test`. The browser-only <rx-price-summary> component is defined via a
 * dynamic import that resolves through the theme's import map at runtime, which
 * keeps the top-level module node-safe.
 */


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

const { buildLineItemProperties, RxState } = await rxImport('rx-core.js');

const CART_ADD_URL_FALLBACK = '/cart/add.js';

/**
 * Add the lens + frame bundle to the cart in a single request. The lens carries
 * the full RX line-item contract; the frame carries the shared bundle hash and
 * SKUs. Section ids let Shopify re-render the cart drawer / icon in the response.
 *
 * @param {RxState} state
 * @param {{subdomain?: string, providerNumber?: string, healthFundNumbers?: string}} [config]
 * @param {string[]} [sectionIds]
 * @returns {Promise<Object>} the cart/add.js response (includes `sections`)
 */
export async function addRxBundle(state, config = {}, sectionIds = []) {
  const { lensProperties, frameProperties } = buildLineItemProperties(state, config);

  const items = [
    { id: state.lensProduct.variantId, quantity: 1, properties: lensProperties },
    { id: state.frame.variantId, quantity: 1, properties: frameProperties },
  ];

  const url = globalThis.Theme?.routes?.cart_add_url ?? CART_ADD_URL_FALLBACK;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items, sections: (sectionIds ?? []).join(',') }),
  });

  if (!response.ok) {
    let message = 'Could not add to cart. Please try again.';
    try {
      const data = await response.json();
      message = data?.description || data?.message || message;
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new Error(message);
  }

  return response.json();
}

// --- Browser-only component -------------------------------------------------

// Shared singleton — the first RX component to initialize creates the state.
function getRxState() {
  window.rxState ??= new RxState();
  return window.rxState;
}

// Product data JSON emitted once by the rx-lens-selector block.
let productDataCache = null;
function getRxProductData() {
  if (productDataCache) return productDataCache;
  const el = document.querySelector('[data-rx-product-data]');
  if (!el) return null;
  try {
    productDataCache = JSON.parse(el.textContent);
  } catch (error) {
    console.error('rx: invalid product data', error);
    return null;
  }
  return productDataCache;
}

// Proxy config lives on the rx-prescription block; sibling blocks can't read it
// in liquid, so the drawer's data attributes are the authoritative source.
function getRxConfig() {
  const fallback = getRxProductData()?.config ?? {};
  const drawer = document.querySelector('rx-prescription-drawer');
  if (!(drawer instanceof HTMLElement)) return fallback;
  return {
    ...fallback,
    subdomain: drawer.dataset.subdomain || fallback.subdomain || '',
    providerNumber: drawer.dataset.providerNumber || fallback.providerNumber || '',
    healthFundNumbers: drawer.dataset.healthFundNumbers || fallback.healthFundNumbers || '',
    checkExpiration:
      drawer.dataset.checkExpiration != null
        ? drawer.dataset.checkExpiration === 'true'
        : fallback.checkExpiration !== false,
  };
}

// Cart sections to re-render after a bundle add (drawer, icon, totals). Mirrors
// product-form.js: every cart-items-component contributes its section id.
function cartSectionIds() {
  const ids = new Set();
  for (const el of document.querySelectorAll('cart-items-component[data-section-id]')) {
    if (el instanceof HTMLElement && el.dataset.sectionId) ids.add(el.dataset.sectionId);
  }
  return [...ids];
}

// Format cents with the shop money format string (e.g. "${{amount}}").
function formatMoney(cents, format) {
  const value = Number(cents) || 0;
  const pattern = format || '${{amount}}';
  return pattern.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token) => {
    let precision = 2;
    let thousands = ',';
    let decimal = '.';
    if (token === 'amount_no_decimals') precision = 0;
    else if (token === 'amount_with_comma_separator') (thousands = '.'), (decimal = ',');
    else if (token === 'amount_no_decimals_with_comma_separator') (precision = 0), (thousands = '.');
    else if (token === 'amount_with_space_separator') (thousands = ' '), (decimal = ',');

    const [whole, frac] = (value / 100).toFixed(precision).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return frac ? `${grouped}${decimal}${frac}` : grouped;
  });
}

async function defineRxPriceSummary() {
  const [{ Component }, { CartAddEvent }] = await Promise.all([
    import('@theme/component'),
    import('@theme/events'),
  ]);

  /**
   * Price breakdown (Frame + Lenses = Total) and the RX add-to-cart button.
   * The button stays disabled until the configurator is complete; on success it
   * dispatches the theme's CartAddEvent so the native cart drawer opens/updates.
   */
  class RxPriceSummary extends Component {
    #state;
    #busy = false;
    #onChange = () => this.#render();

    // Reference-site flow: submitting the prescription drawer (or choosing
    // "add later") continues straight into the cart add. The PDP has exactly
    // one drawer; my-orders hosts its own but never renders a price summary.
    #onPrescriptionSubmit = (event) => {
      if (event.target instanceof Element && event.target.matches('rx-prescription-drawer')) {
        this.addToCart({ fromDrawer: true });
      }
    };

    connectedCallback() {
      super.connectedCallback();
      this.#state = getRxState();
      this.#state.addEventListener('rx:change', this.#onChange);
      document.addEventListener('rx:prescription-submit', this.#onPrescriptionSubmit);
      this.#render();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.#state?.removeEventListener('rx:change', this.#onChange);
      document.removeEventListener('rx:prescription-submit', this.#onPrescriptionSubmit);
    }

    /** Add the configured bundle to the cart. Bound via `on:click="/addToCart"`. */
    async addToCart(opts = {}) {
      const state = this.#state;
      if (this.#busy || !state?.lensProduct) return;

      // No prescription yet: the button opens the drawer; the submit event
      // brings us back here with the prescription in place.
      if (!state.isComplete && !opts.fromDrawer) {
        document.querySelector('rx-prescription-drawer')?.start?.();
        return;
      }
      if (!state.isComplete) return;

      this.#busy = true;
      this.#setError('');
      this.#render();

      try {
        const response = await addRxBundle(state, getRxConfig(), cartSectionIds());

        this.dispatchEvent(
          new CartAddEvent({}, this.id, {
            source: 'rx-cart',
            itemCount: 2,
            productId: state.frame.productId,
            sections: response.sections,
          })
        );

        // This store runs without a cart drawer — take the customer to the cart.
        window.location.assign(window.Theme?.routes?.cart_url || '/cart');
      } catch (error) {
        console.error('rx: add to cart failed', error);
        this.#setError(error?.message || 'Could not add to cart. Please try again.');
      } finally {
        this.#busy = false;
        this.#render();
      }
    }

    #moneyFormat() {
      const tpl = this.querySelector('[data-rx-money-format]');
      return tpl instanceof HTMLTemplateElement ? tpl.content.textContent?.trim() : tpl?.textContent?.trim();
    }

    #setText(selector, text) {
      const el = this.querySelector(selector);
      if (el) el.textContent = text;
    }

    #setError(message) {
      const el = this.querySelector('[data-rx-error]');
      if (!el) return;
      el.textContent = message;
      el.hidden = !message;
    }

    #render() {
      const state = this.#state;
      const frame = state?.frame;
      if (!frame) {
        this.hidden = true;
        return;
      }
      this.hidden = false;

      const format = this.#moneyFormat();
      const lens = state.lensProduct;
      const lensPrice = lens?.price ?? 0;

      this.#setText('[data-rx-frame-price]', formatMoney(frame.price ?? 0, format));
      this.#setText('[data-rx-lens-price]', formatMoney(lensPrice, format));
      this.#setText('[data-rx-total-price]', formatMoney(state.totalPrice, format));

      const lensLine = this.querySelector('[data-rx-lens-line]');
      if (lensLine) lensLine.hidden = !lens;

      const button = this.querySelector('[data-rx-atc]');
      if (button instanceof HTMLButtonElement) button.disabled = this.#busy || !state.lensProduct;

      this.classList.toggle('rx-price-summary--busy', this.#busy);
    }
  }

  if (!customElements.get('rx-price-summary')) {
    customElements.define('rx-price-summary', RxPriceSummary);
  }
}

// Define the component only in the browser; keeps this module node-testable.
if (typeof customElements !== 'undefined') {
  defineRxPriceSummary().catch((error) => console.error('rx: price summary init failed', error));
}
