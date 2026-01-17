import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { CartUpdateEvent, ThemeEvents } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint, getIOSVersion } from '@theme/utilities';

export class QuickAddComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Map<string, Element>} */
  #cachedContent = new Map();

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    const productLink = productCard?.getProductCardLink();

    if (!productLink?.href) return '';

    const url = new URL(productLink.href);

    // Priority 1: Use variant from URL if present (most reliable for featured image swatches)
    if (url.searchParams.has('variant')) {
      return url.toString();
    }

    // Priority 2: Try to get variant ID from selected input
    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) {
      url.searchParams.set('variant', selectedVariantId);
    }

    return url.toString();
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null
   */
  #getSelectedVariantId() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    return productCard?.getSelectedVariantId() || null;
  }

  /**
   * Clears the cached content. Used when the product changes to ensure fresh data.
   */
  clearCache() {
    this.#cachedContent.clear();
  }

  connectedCallback() {
    super.connectedCallback();

    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
    this.#abortController?.abort();
  }

  /**
   * Handles quick add button click
   * @param {Event} event - The click event
   */
  handleClick = async (event) => {
    event.preventDefault();

    const currentUrl = this.productPageUrl;

    // Check if we have cached content for this URL
    let productGrid = this.#cachedContent.get(currentUrl);

    if (!productGrid) {
      // Fetch and cache the content
      const html = await this.fetchProductPage(currentUrl);
      if (html) {
        const gridElement = html.querySelector('[data-product-grid-content]');
        if (gridElement) {
          // Cache the cloned element to avoid modifying the original
          productGrid = /** @type {Element} */ (gridElement.cloneNode(true));
          this.#cachedContent.set(currentUrl, productGrid);
        }
      }
    }

    if (productGrid) {
      // Use a fresh clone from the cache
      const freshContent = /** @type {Element} */ (productGrid.cloneNode(true));
      await this.updateQuickAddModal(freshContent);
    }

    // CRITICAL: After updating the modal, ensure the variant ID input is set correctly
    // The fetched HTML might have the default variant, so we need to override it
    const modalContent = document.getElementById('quick-add-modal-content');
    if (modalContent) {
      // Get variant ID from URL (most reliable)
      const url = new URL(currentUrl);
      const variantIdFromUrl = url.searchParams.get('variant');
      
      if (variantIdFromUrl) {
        // Update the hidden variant ID input in the form
        const variantIdInput = modalContent.querySelector('input[name="id"][ref="variantId"]');
        if (variantIdInput instanceof HTMLInputElement) {
          variantIdInput.value = variantIdFromUrl;
        }
      }
    }

    this.#openQuickAddModal();
  };

  /** @param {QuickAddDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    dialogComponent.closeDialog();
  };

  /**
   * Fetches the product page content
   * @param {string} productPageUrl - The URL of the product page to fetch
   * @returns {Promise<Document | null>}
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();
      const html = new DOMParser().parseFromString(responseText, 'text/html');

      return html;
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  /**
   * Re-renders the variant picker.
   * @param {Element} productGrid - The product grid element
   */
  async updateQuickAddModal(productGrid) {
    const modalContent = document.getElementById('quick-add-modal-content');

    if (!productGrid || !modalContent) return;

    if (isMobileBreakpoint()) {
      const productDetails = productGrid.querySelector('.product-details');
      const productFormComponent = productGrid.querySelector('product-form-component');
      const variantPicker = productGrid.querySelector('variant-picker');
      const productPrice = productGrid.querySelector('product-price');
      const productTitle = document.createElement('a');
      productTitle.textContent = this.dataset.productTitle || '';

      // Make product title as a link to the product page
      productTitle.href = this.productPageUrl;

      const productHeader = document.createElement('div');
      productHeader.classList.add('product-header');

      productHeader.appendChild(productTitle);
      if (productPrice) {
        productHeader.appendChild(productPrice);
      }
      productGrid.appendChild(productHeader);

      if (variantPicker) {
        productGrid.appendChild(variantPicker);
      }
      if (productFormComponent) {
        productGrid.appendChild(productFormComponent);
      }

      productDetails?.remove();
    }

    morph(modalContent, productGrid);

    // CRITICAL: Sync variant selection FIRST, then update variant ID input
    // This ensures the variant picker is in the correct state before we update the form
    this.#syncVariantSelection(modalContent);
    
    // CRITICAL: After syncing variant selection, update the variant ID input
    // The fetched HTML might have the default variant, not the one from the URL
    // We need to extract the variant ID from the productPageUrl and set it directly
    // Do this AFTER syncVariantSelection to ensure variant picker events don't overwrite it
    const url = new URL(this.productPageUrl);
    const variantIdFromUrl = url.searchParams.get('variant');
    
    if (variantIdFromUrl) {
      // Wait a tick for morph and sync to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Find and update the variant ID input
      let variantIdInput = modalContent.querySelector('input[name="id"][ref="variantId"]');
      if (!variantIdInput) {
        variantIdInput = modalContent.querySelector('input[name="id"]');
      }
      if (variantIdInput instanceof HTMLInputElement) {
        variantIdInput.value = variantIdFromUrl;
        // Don't dispatch change event - we don't want to trigger variant update events
        // that might overwrite our value
        
        // CRITICAL: Also update the ProductFormComponent's refs.variantId if it exists
        // This ensures the component's internal state is also updated
        const productFormComponent = modalContent.querySelector('product-form-component');
        if (productFormComponent && productFormComponent.refs?.variantId) {
          productFormComponent.refs.variantId.value = variantIdFromUrl;
        }
      }
    }
  }

  /**
   * Syncs the variant selection from the product card to the modal
   * @param {Element} modalContent - The modal content element
   */
  #syncVariantSelection(modalContent) {
    // Priority 1: Get variant ID from URL (most reliable for featured image swatches)
    // The URL is updated immediately when a swatch is clicked, so it's more reliable
    // than querying the DOM which might not be updated yet
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    const productLink = productCard?.getProductCardLink();
    let selectedVariantId = null;
    
    if (productLink?.href) {
      const url = new URL(productLink.href);
      selectedVariantId = url.searchParams.get('variant');
    }
    
    // Priority 2: Fall back to getSelectedVariantId if URL doesn't have variant
    if (!selectedVariantId) {
      selectedVariantId = this.#getSelectedVariantId();
    }
    
    if (!selectedVariantId) return;

    // Find and check the corresponding input in the modal
    // Try both data-variant-id and data-first-available-or-first-variant-id
    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id], input[type="radio"][data-first-available-or-first-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement) {
        const inputVariantId = input.dataset.variantId || input.dataset.firstAvailableOrFirstVariantId;
        if (inputVariantId === selectedVariantId && !input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }

    // CRITICAL: Update the hidden variant ID input in the form
    // This is what actually gets submitted when adding to cart
    // Try multiple selectors to find the input
    let variantIdInput = modalContent.querySelector('input[name="id"][ref="variantId"]');
    if (!variantIdInput) {
      variantIdInput = modalContent.querySelector('input[name="id"]');
    }
    if (variantIdInput instanceof HTMLInputElement) {
      variantIdInput.value = selectedVariantId;
      
      // Also trigger a change event to ensure any listeners are notified
      variantIdInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

if (!customElements.get('quick-add-component')) {
  customElements.define('quick-add-component', QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductTitleLink);

    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  /**
   * Closes the dialog
   * @param {CartUpdateEvent} event - The cart update event
   */
  handleCartUpdate = (event) => {
    if (event.detail.data.didError) return;
    this.closeDialog();
  };

  #updateProductTitleLink = (/** @type {CustomEvent} */ event) => {
    const anchorElement = /** @type {HTMLAnchorElement} */ (
      event.detail.data.html?.querySelector('.view-product-title a')
    );
    const viewMoreDetailsLink = /** @type {HTMLAnchorElement} */ (this.querySelector('.view-product-title a'));
    const mobileProductTitle = /** @type {HTMLAnchorElement} */ (this.querySelector('.product-header a'));

    if (!anchorElement) return;

    if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
    if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
  };

  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    /**
     * This is a patch to solve an issue with the UI freezing when the dialog is closed.
     * To reproduce it, use iOS 16.0.
     */
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      /** @type {HTMLElement | null} */
      const grid = document.querySelector('#ResultsList [product-grid-view]');
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = '';
        });
      }
    });
  };
}

if (!customElements.get('quick-add-dialog')) {
  customElements.define('quick-add-dialog', QuickAddDialog);
}
