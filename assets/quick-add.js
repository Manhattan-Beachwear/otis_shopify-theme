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
  /** @type {Map<string, Element>} */
  #cachedContentCL = new Map();
  /** @type {string} */
  #clModalCurrentUrl = '';
  /** @type {boolean} */
  #clModalLoadInProgress = false;

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    const productLink = productCard?.getProductCardLink();

    if (!productLink?.href) return '';

    const url = new URL(productLink.href);

    // Priority 1: Use variant from URL if present (most reliable for featured image swatches)
    // Priority 1: Use variant from URL if present (most reliable for featured image swatches)
    if (url.searchParams.has('variant')) {
      return url.toString();
    }

    // Priority 2: Try to get variant ID from selected input
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
    this.#cachedContentCL.clear();
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
    const isCl = this.dataset.combinedListing === 'true';
    const cache = isCl ? this.#cachedContentCL : this.#cachedContent;

    // Check if we have cached content for this URL
    let productGrid = cache.get(currentUrl);

    if (!productGrid) {
      // Fetch and cache the content
      const html = await this.fetchProductPage(currentUrl);
      if (html) {
        const gridElement = html.querySelector('[data-product-grid-content]');
        if (gridElement) {
          // Cache the cloned element to avoid modifying the original
          productGrid = /** @type {Element} */ (gridElement.cloneNode(true));
          cache.set(currentUrl, productGrid);
        }
      }
    }

    if (productGrid) {
      // Use a fresh clone from the cache
      const freshContent = /** @type {Element} */ (productGrid.cloneNode(true));
      await this.updateQuickAddModal(freshContent, { useClModal: isCl });
    }

    // CRITICAL: After updating the modal, ensure the variant ID input is set correctly
    const modalContentId = isCl ? 'quick-add-modal-content-cl' : 'quick-add-modal-content';
    const modalContent = document.getElementById(modalContentId);
    if (modalContent) {
      const url = new URL(currentUrl);
      const variantIdFromUrl = url.searchParams.get('variant');
      if (variantIdFromUrl) {
        const variantIdInput = modalContent.querySelector('input[name="id"][ref="variantId"]');
        if (variantIdInput instanceof HTMLInputElement) {
          variantIdInput.value = variantIdFromUrl;
        }
      }
      if (isCl) {
        this.#clModalCurrentUrl = url.pathname;
      }
    }

    if (isCl) {
      this.#openQuickAddModalCL();
    } else {
      this.#openQuickAddModal();
    }
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

  #openQuickAddModalCL = () => {
    const dialogComponent = document.getElementById('quick-add-dialog-cl');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();
  };

  #closeQuickAddModal = () => {
    const standardDialog = document.getElementById('quick-add-dialog');
    const clDialog = document.getElementById('quick-add-dialog-cl');
    if (standardDialog instanceof QuickAddDialog) standardDialog.closeDialog();
    if (clDialog instanceof QuickAddDialog) clDialog.closeDialog();
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
   * @param {{ useClModal?: boolean }} [options] - When useClModal is true, target the combined listing modal
   */
  async updateQuickAddModal(productGrid, options = {}) {
    const useClModal = options.useClModal === true;
    const modalContentId = useClModal ? 'quick-add-modal-content-cl' : 'quick-add-modal-content';
    const modalContent = document.getElementById(modalContentId);

    if (!productGrid || !modalContent) return;

    if (isMobileBreakpoint()) {
      const productDetails = productGrid.querySelector('.product-details');
      const productFormComponent = productGrid.querySelector('product-form-component');
      // Support both standard and combined listing variant pickers
      const variantPicker = productGrid.querySelector('variant-picker, variant-picker-cl, variant-picker-cl-dual');
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
        if (productFormComponent && /** @type {any} */ (productFormComponent).refs?.variantId) {
          /** @type {any} */ (productFormComponent).refs.variantId.value = variantIdFromUrl;
        }
      }
    }

    // Set up listener for variant changes in combined listing pickers within the modal
    // This ensures the form's variant ID input stays in sync when users change variants
    this.#setupCombinedListingVariantListener(modalContent);

    // When modal content has a combined listing picker (standard or CL modal), load the selected product on swatch change
    // so image, title, and price update; works regardless of which modal was opened (section may not set data-combined-listing)
    const hasClPicker = modalContent.querySelector('variant-picker-cl, variant-picker-cl-dual') !== null;
    if (hasClPicker) {
      this.#setupCombinedListingSwatchLoadProduct(modalContent);
    }
  }

  /**
   * Sets up a listener for variant changes in combined listing pickers within the modal
   * @param {Element} modalContent - The modal content element
   */
  #setupCombinedListingVariantListener(modalContent) {
    // Find combined listing variant pickers in the modal
    const combinedListingPickers = modalContent.querySelectorAll('variant-picker-cl, variant-picker-cl-dual');
    
    for (const picker of combinedListingPickers) {
      // Listen for change events on radio inputs within the picker
      // Note: We don't need to clean up these listeners as they're automatically removed
      // when the modal content is replaced on the next open
      picker.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLInputElement)) return;
        if (event.target.type !== 'radio') return;

        const variantId = event.target.dataset.variantId || event.target.value;
        const connectedProductUrl = event.target.dataset.connectedProductUrl;

        // For combined listings, extract variant ID from connected product URL if available
        let finalVariantId = variantId;
        if (connectedProductUrl) {
          try {
            const url = new URL(connectedProductUrl, window.location.origin);
            const urlVariantId = url.searchParams.get('variant');
            if (urlVariantId) {
              finalVariantId = urlVariantId;
            }
          } catch (e) {
            // If URL parsing fails, use the variant ID from the input
          }
        }

        // Update the form's variant ID input
        if (finalVariantId) {
          this.#updateVariantIdInput(modalContent, finalVariantId);
        }
      });
    }
  }

  /**
   * Sets up listener so that when a swatch is selected in the CL modal, we fetch that product's
   * page (with the selected variant) and load it into the modal so image, title, and price update.
   * @param {Element} modalContent - The CL modal content element (#quick-add-modal-content-cl)
   */
  #setupCombinedListingSwatchLoadProduct(modalContent) {
    const pickers = modalContent.querySelectorAll('variant-picker-cl, variant-picker-cl-dual');
    for (const picker of pickers) {
      picker.addEventListener('change', async (event) => {
        if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'radio') return;
        const connectedProductUrl = event.target.dataset.connectedProductUrl;
        const variantId = event.target.dataset.variantId || event.target.value;
        if (!connectedProductUrl || !variantId) return;

        try {
          const url = new URL(connectedProductUrl, window.location.origin);
          url.searchParams.set('variant', variantId);
          const productUrl = url.toString();
          await this.#loadProductIntoClModal(productUrl, modalContent, variantId);
        } catch (e) {
          // If URL parsing fails, skip load
        }
      });
    }
  }

  /**
   * Fetches a product page and morphs its content into the CL modal; updates variant ID and re-attaches listeners.
   * @param {string} productUrl - Full product URL (with variant param)
   * @param {Element} modalContent - The CL modal content element
   * @param {string} variantId - The variant ID to set in the form
   */
  async #loadProductIntoClModal(productUrl, modalContent, variantId) {
    if (this.#clModalLoadInProgress) return;
    this.#clModalLoadInProgress = true;
    try {
      let productGrid = this.#cachedContentCL.get(productUrl);
      if (!productGrid) {
        const html = await this.fetchProductPage(productUrl);
        const gridElement = html?.querySelector('[data-product-grid-content]');
        if (html && gridElement) {
          productGrid = /** @type {Element} */ (gridElement.cloneNode(true));
          this.#cachedContentCL.set(productUrl, productGrid);
        }
      }
      if (!productGrid) return;

      const freshContent = /** @type {Element} */ (productGrid.cloneNode(true));
      if (isMobileBreakpoint()) {
        const productDetails = freshContent.querySelector('.product-details');
        const productFormComponent = freshContent.querySelector('product-form-component');
        const variantPicker = freshContent.querySelector('variant-picker, variant-picker-cl, variant-picker-cl-dual');
        const productPrice = freshContent.querySelector('product-price');
        const productTitle = document.createElement('a');
        productTitle.textContent = this.dataset.productTitle || '';
        productTitle.href = productUrl;
        const productHeader = document.createElement('div');
        productHeader.classList.add('product-header');
        productHeader.appendChild(productTitle);
        if (productPrice) productHeader.appendChild(productPrice);
        freshContent.appendChild(productHeader);
        if (variantPicker) freshContent.appendChild(variantPicker);
        if (productFormComponent) freshContent.appendChild(productFormComponent);
        productDetails?.remove();
      }

      morph(modalContent, freshContent);
      try {
        this.#clModalCurrentUrl = new URL(productUrl, window.location.origin).pathname;
      } catch (e) {
        this.#clModalCurrentUrl = '';
      }
      this.#updateVariantIdInput(modalContent, variantId);
      this.#setupCombinedListingVariantListener(modalContent);
      this.#setupCombinedListingSwatchLoadProduct(modalContent);
    } finally {
      this.#clModalLoadInProgress = false;
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

    // Check if this is a combined listing variant picker
    const hasCombinedListingPicker = modalContent.querySelector('variant-picker-cl, variant-picker-cl-dual') !== null;

    // Find and check the corresponding input in the modal
    // For combined listings, also check data-connected-product-url to ensure we're matching the right product
    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id], input[type="radio"][data-first-available-or-first-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement) {
        const inputVariantId = input.dataset.variantId || input.dataset.firstAvailableOrFirstVariantId;
        
        // For combined listings, also verify the product URL matches if available
        if (hasCombinedListingPicker && input.dataset.connectedProductUrl) {
          const connectedUrl = new URL(input.dataset.connectedProductUrl, window.location.origin);
          const connectedVariantId = connectedUrl.searchParams.get('variant');
          
          // Match by variant ID from connected product URL for combined listings
          if (connectedVariantId === selectedVariantId && !input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // Update variant ID input with the variant from the connected product URL
            this.#updateVariantIdInput(modalContent, connectedVariantId);
            return;
          }
        }
        
        // Standard matching for non-combined listings or fallback
        if (inputVariantId === selectedVariantId && !input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }

    // CRITICAL: Update the hidden variant ID input in the form
    // This is what actually gets submitted when adding to cart
    this.#updateVariantIdInput(modalContent, selectedVariantId);
  }

  /**
   * Updates the variant ID input in the form
   * @param {Element} modalContent - The modal content element
   * @param {string} variantId - The variant ID to set
   */
  #updateVariantIdInput(modalContent, variantId) {
    // Try multiple selectors to find the input
    let variantIdInput = modalContent.querySelector('input[name="id"][ref="variantId"]');
    if (!variantIdInput) {
      variantIdInput = modalContent.querySelector('input[name="id"]');
    }
    if (variantIdInput instanceof HTMLInputElement) {
      variantIdInput.value = variantId;
      
      // Also trigger a change event to ensure any listeners are notified
      variantIdInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      // CRITICAL: Also update the ProductFormComponent's refs.variantId if it exists
      // This ensures the component's internal state is also updated
      const productFormComponent = /** @type {any} */ (modalContent.querySelector('product-form-component'));
      if (productFormComponent?.refs?.variantId) {
        productFormComponent.refs.variantId.value = variantId;
      }
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
