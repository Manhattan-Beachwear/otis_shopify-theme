/**
 * Klaviyo Back In Stock component
 */
class KlaviyoBisComponent extends HTMLElement {
  #abortController = new AbortController();

  connectedCallback() {
    const { signal } = this.#abortController;

    const scopeTarget = this.closest('.shopify-section, dialog, product-card');
    scopeTarget?.addEventListener('variant:update', this.#onVariantUpdate, { signal });
  }

  disconnectedCallback() {
    this.#abortController.abort();
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

    const isAvailable = resource !== null && resource?.available !== false;
    this.hidden = isAvailable;

    if (resource?.id) {
      this.dataset.variantId = resource.id;

      const button = this.querySelector('.klaviyo-bis-trigger');
      if (button) {
        button.setAttribute('data-variant-id', resource.id);
      }
    }

    if (!isAvailable) {
      this.#tryKlaviyoRescan();
    }
  };

  #tryKlaviyoRescan() {
    if (!window.klaviyo || typeof window.klaviyo.push !== 'function') return;

    window.klaviyo.push(function () {
      if (window.KlaviyoSubscriptions && typeof window.KlaviyoSubscriptions.init === 'function') {
        window.KlaviyoSubscriptions.init();
      }
    });
  }
}

if (!customElements.get('klaviyo-bis-component')) {
  customElements.define('klaviyo-bis-component', KlaviyoBisComponent);
}
