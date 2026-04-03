/**
 * Klaviyo Back In Stock component
 */
class KlaviyoBisComponent extends HTMLElement {
  #abortController = new AbortController();
  /** @type {MutationObserver | null} */
  #childObserver = null;

  connectedCallback() {
    const { signal } = this.#abortController;

    const scopeTarget = this.closest('.shopify-section, dialog, product-card');
    // Capture: run before product-form-component's bubble listener so morphed ATC/disabled state is not overwritten yet (combined listings).
    scopeTarget?.addEventListener('variant:update', this.#onVariantUpdate, { capture: true, signal });

    this.#ensureChildObserver();
    queueMicrotask(() => this.#syncFallbackButtonVisibility());
  }

  disconnectedCallback() {
    this.#abortController.abort();
    this.#childObserver?.disconnect();
    this.#childObserver = null;
  }

  /**
   * Klaviyo Subscriptions injects a control with data-a11y-identifier bis-button-* (see Back in Stock form).
   * @returns {boolean}
   */
  #hasKlaviyoInjectedButton() {
    return !!this.querySelector(
      'button[type="button"][data-a11y-identifier^="bis-button-"], [data-a11y-identifier^="bis-button-"] button[type="button"]',
    );
  }

  /** Show theme fallback only when Klaviyo has not injected its own button yet. */
  #syncFallbackButtonVisibility() {
    const fallback = this.querySelector('.klaviyo-bis-trigger');
    if (!(fallback instanceof HTMLButtonElement)) return;

    if (this.hidden) {
      fallback.hidden = false;
      return;
    }

    fallback.hidden = this.#hasKlaviyoInjectedButton();
  }

  #ensureChildObserver() {
    if (this.#childObserver) return;
    this.#childObserver = new MutationObserver(() => this.#syncFallbackButtonVisibility());
    this.#childObserver.observe(this, { childList: true, subtree: true });
  }

  /**
   * Live form after morph; use with capture listener + data.newProduct so ATC has not been overwritten by product-form yet.
   * @returns {{ source: 'live-atc'; canPurchase: boolean; variantId: string | null } | null}
   */
  #purchaseStateFromLiveForm() {
    const form = this.closest('product-form-component');
    if (!(form instanceof HTMLElement)) return null;

    const atcBtn =
      form.querySelector('button[ref="addToCartButton"]') ||
      form.querySelector('button[type="submit"][name="add"]');
    if (!(atcBtn instanceof HTMLButtonElement)) return null;

    const idInput = form.querySelector('input[name="id"]');
    const variantId = idInput instanceof HTMLInputElement ? idInput.value : null;
    return { source: 'live-atc', canPurchase: !atcBtn.disabled, variantId };
  }

  /**
   * Same purchase signal as Liquid `can_add_to_cart` / BIS `hidden`, from fetched PDP HTML.
   * @param {Document | ParentNode | null | undefined} htmlRoot
   * @param {string | undefined} productIdHint - `data-product-id` on product-form-component
   * @returns {{ source: 'bis' | 'atc'; canPurchase: boolean; variantId: string | null } | null}
   */
  #purchaseStateFromFetchedHtml(htmlRoot, productIdHint) {
    if (!htmlRoot || typeof htmlRoot.querySelectorAll !== 'function') return null;

    /** @type {HTMLElement[]} */
    const pfcs = Array.from(htmlRoot.querySelectorAll('product-form-component')).filter(
      (el) => el instanceof HTMLElement,
    );
    const ordered =
      productIdHint && pfcs.some((p) => p.dataset.productId === productIdHint)
        ? pfcs.filter((p) => p.dataset.productId === productIdHint)
        : pfcs;

    for (const pfc of ordered) {
      const bis = pfc.querySelector('klaviyo-bis-component');
      if (bis instanceof HTMLElement) {
        const idInput = pfc.querySelector('input[name="id"]');
        const idFromInput = idInput instanceof HTMLInputElement ? idInput.value : null;
        const variantId =
          bis.getAttribute('data-variant-id') ||
          bis.querySelector('.klaviyo-bis-trigger')?.getAttribute('data-variant-id') ||
          idFromInput ||
          null;
        return { source: 'bis', canPurchase: bis.hasAttribute('hidden'), variantId };
      }

      const atcBtn =
        pfc.querySelector('button[ref="addToCartButton"]') ||
        pfc.querySelector('button[type="submit"][name="add"]');
      if (atcBtn instanceof HTMLButtonElement) {
        const idInput = pfc.querySelector('input[name="id"]');
        const variantId = idInput instanceof HTMLInputElement ? idInput.value : null;
        return { source: 'atc', canPurchase: !atcBtn.hasAttribute('disabled'), variantId };
      }
    }

    return null;
  }

  #onVariantUpdate = (/** @type {CustomEvent} */ event) => {
    const { resource, data } = event.detail;

    if (data?.newProduct) {
      this.dataset.productId = data.newProduct.id;
    } else if (
      data?.productId &&
      this.dataset.productId &&
      data.productId !== this.dataset.productId
    ) {
      return;
    }

    /** @type {boolean} */
    let isAvailable;
    const htmlRoot = data?.html;

    /** @type {{ source: string; canPurchase: boolean; variantId: string | null } | null} */
    let resolved = null;

    if (data?.newProduct) {
      resolved = this.#purchaseStateFromLiveForm();
    }
    if (!resolved) {
      resolved = this.#purchaseStateFromFetchedHtml(htmlRoot, this.dataset.productId);
    }
    if (!resolved) {
      resolved = {
        source: 'resource',
        canPurchase: resource !== null && resource?.available !== false,
        variantId: resource?.id ? String(resource.id) : null,
      };
    }

    this.hidden = resolved.canPurchase;
    isAvailable = resolved.canPurchase;

    const variantId = resolved.variantId || (resource?.id ? String(resource.id) : null);
    if (variantId) {
      this.dataset.variantId = variantId;
      const button = this.querySelector('.klaviyo-bis-trigger');
      if (button) {
        button.setAttribute('data-variant-id', variantId);
      }
    }

    if (!isAvailable) {
      this.#tryKlaviyoRescan();
    }

    queueMicrotask(() => this.#syncFallbackButtonVisibility());
  };

  #tryKlaviyoRescan() {
    if (!window.klaviyo || typeof window.klaviyo.push !== 'function') return;

    window.klaviyo.push(() => {
      if (window.KlaviyoSubscriptions && typeof window.KlaviyoSubscriptions.init === 'function') {
        window.KlaviyoSubscriptions.init();
      }
      queueMicrotask(() => this.#syncFallbackButtonVisibility());
    });
  }
}

if (!customElements.get('klaviyo-bis-component')) {
  customElements.define('klaviyo-bis-component', KlaviyoBisComponent);
}
