import { Component } from '@theme/component';
import { morph } from '@theme/morph';
import { requestYieldCallback } from '@theme/utilities';
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent } from '@theme/events';
import { updateSelectedOptionPillAnimation } from './variant-picker-utils.js';

/**
 * A custom element that manages a combined listing variant picker.
 * Displays each related product as a single variant option and handles navigation using morphing.
 *
 * @extends Component
 */
export default class VariantPickerCL extends Component {
  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {string | undefined} */
  #currentProductUrl;

  connectedCallback() {
    super.connectedCallback();

    // Store current product URL
    this.#currentProductUrl = this.dataset.productUrl?.split('?')[0];

    // Listen for change events on radio inputs
    this.addEventListener('change', this.#handleProductSelection.bind(this));
  }

  /**
   * Handles the product selection change event.
   * @param {Event} event - The change event.
   */
  #handleProductSelection(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.target.type !== 'radio') return;

    const selectedInput = event.target;
    const productUrl = selectedInput.dataset.productUrl;
    const productId = selectedInput.dataset.productId;
    const variantId = selectedInput.value;

    if (!productUrl) {
      return;
    }

    // Step 1: Dispatch VariantSelectedEvent FIRST to disable buttons (before UI updates)
    this.dispatchEvent(
      new VariantSelectedEvent({
        id: variantId,
      })
    );

    // Step 2: Defer navigation to next frame (after buttons are disabled)
    // This ensures buttons disable first, then UI updates, matching variant-main-picker behavior
    requestAnimationFrame(() => {
      // Parse the product URL to check if it's a different product
      const newProductUrl = productUrl.split('?')[0];
      const isDifferentProduct = this.#currentProductUrl !== newProductUrl;

      // Always use morphing for combined listings since we're switching products
      // This ensures all sections update (recommendations, metafields, etc.)
      this.#fetchAndMorphProduct(productUrl, isDifferentProduct, variantId);
    });

    // Update browser history
    const url = new URL(productUrl, window.location.origin);

    if (url.href !== window.location.href) {
      requestYieldCallback(() => {
        history.replaceState({}, '', url.toString());
      });
    }
  }

  /**
   * Fetches the updated product page and morphs the main content.
   * @param {string} productUrl - The product URL with variant parameter.
   * @param {boolean} isDifferentProduct - Whether this is a different product.
   * @param {string} variantId - The variant ID for the event.
   */
  #fetchAndMorphProduct(productUrl, isDifferentProduct, variantId) {
    // Abort any pending requests
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    fetch(productUrl, { signal: this.#abortController.signal })
      .then((response) => {
        return response.text();
      })
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        const main = document.querySelector('main');
        const newMain = html.querySelector('main');

        if (!main || !newMain) {
          throw new Error('No main element found in response');
        }

        // Get variant data from the response (matching variant-picker.js behavior)
        // Look for variant data in product-form-component or variant-picker script tag
        const variantScript =
          html.querySelector('variant-picker script[type="application/json"]')?.textContent ||
          html.querySelector('product-form-component script[type="application/json"]')?.textContent;

        let variantData = null;
        if (variantScript) {
          try {
            variantData = JSON.parse(variantScript);
          } catch (e) {
            // Silently handle parse errors
          }
        }

        // Get product ID from the new HTML
        const newProductForm = html.querySelector('product-form-component');
        const newProductId =
          (newProductForm instanceof HTMLElement ? newProductForm.dataset.productId : null) || this.dataset.productId;

        // Determine if product changed
        const productUrlBase = productUrl.split('?')[0];
        const newProduct =
          isDifferentProduct && newProductId && newProductId !== this.dataset.productId && productUrlBase
            ? { id: newProductId, url: productUrlBase }
            : undefined;

        // Morph the entire main content
        morph(main, newMain);

        // Update current product URL
        this.#currentProductUrl = productUrl.split('?')[0];

        // Dispatch VariantUpdateEvent to re-enable buttons (matching variant-main-picker behavior)
        // Use the variantId as sourceId (similar to how variant-picker uses selectedOptionId)
        this.dispatchEvent(
          new VariantUpdateEvent(variantData, variantId || '', {
            html,
            productId: newProductId || this.dataset.productId || '',
            newProduct,
          })
        );
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          // Silently handle errors
        }
      });
  }
}

if (!customElements.get('variant-picker-cl')) {
  customElements.define('variant-picker-cl', VariantPickerCL);
}

/**
 * A custom element that manages a dual variant picker (Color + Size) for combined listings.
 * Filters options based on selections and navigates to the matching product.
 *
 * @extends Component
 */
export class VariantPickerCLDual extends Component {
  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {string | undefined} */
  #currentProductUrl;

  /**
   * @type {Array<{productId: string, variantId: string, color: string, size: string, productUrl: string, available: boolean, isCurrent: boolean}>}
   */
  #combinations = [];

  /** @type {string | undefined} */
  #selectedColor;

  /** @type {string | undefined} */
  #selectedSize;

  /** @type {number[][]} */
  #checkedIndices = [];

  /** @type {HTMLInputElement[][]} */
  #radios = [];

  /** @type {(() => void) | undefined} */
  #boundHandleUrlChange;

  /** @type {((event: VariantUpdateEvent) => void) | undefined} */
  #boundHandleVariantUpdate;

  connectedCallback() {
    super.connectedCallback();

    // Store current product URL
    this.#currentProductUrl = window.location.pathname;

    // Parse combinations data
    const combinationsData = this.dataset.combinations;
    if (combinationsData) {
      this.#combinations = this.#parseCombinations(combinationsData);
    }

    // Get initial selections
    this.#selectedColor = this.dataset.currentColor || undefined;
    this.#selectedSize = this.dataset.currentSize || undefined;

    // Initialize radio tracking for pill animation (matching variant-main-picker)
    const optionsContainers = this.querySelectorAll('.variant-picker-cl-dual__options[data-fieldset-index]');
    optionsContainers.forEach((container) => {
      const radios = Array.from(container.querySelectorAll('input[type="radio"]')).filter(
        /**
         * @param {Element} el
         * @returns {el is HTMLInputElement}
         */
        (el) => el instanceof HTMLInputElement
      );
      this.#radios.push(radios);

      const initialCheckedIndex = radios.findIndex((radio) => radio.dataset.currentChecked === 'true');
      if (initialCheckedIndex !== -1) {
        this.#checkedIndices.push([initialCheckedIndex]);
      } else {
        this.#checkedIndices.push([]);
      }
    });

    // Initialize filtering
    this.#updateFiltering();

    // Listen for change events on radio inputs
    this.addEventListener('change', this.#handleSelectionChange.bind(this));

    // Listen for URL changes (browser back/forward, direct URL changes)
    this.#boundHandleUrlChange = this.#handleUrlChange.bind(this);
    if (this.#boundHandleUrlChange) {
      window.addEventListener('popstate', this.#boundHandleUrlChange);
    }

    // Listen for variant update events from other pickers (like variant-picker)
    this.#boundHandleVariantUpdate = this.#handleVariantUpdate.bind(this);
    if (this.#boundHandleVariantUpdate) {
      document.addEventListener(ThemeEvents.variantUpdate, this.#boundHandleVariantUpdate);
    }

    // Check URL on initial load to sync with URL parameters
    this.#syncFromUrl();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.#boundHandleUrlChange !== undefined) {
      window.removeEventListener('popstate', this.#boundHandleUrlChange);
      this.#boundHandleUrlChange = undefined;
    }
    if (this.#boundHandleVariantUpdate !== undefined) {
      document.removeEventListener(ThemeEvents.variantUpdate, this.#boundHandleVariantUpdate);
      this.#boundHandleVariantUpdate = undefined;
    }
  }

  /**
   * Handles URL changes (browser back/forward navigation).
   */
  #handleUrlChange() {
    this.#syncFromUrl();
  }

  /**
   * Handles variant update events from other pickers (like variant-picker).
   * Syncs the dual picker state when the main variant picker changes.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #handleVariantUpdate(event) {
    // Ignore events from this picker itself (to avoid infinite loops)
    if (event.target === this) {
      return;
    }

    // If the event includes HTML data, the page was morphed - reinitialize after a delay
    // to ensure DOM is fully updated
    if (event.detail?.data?.html) {
      requestYieldCallback(() => {
        // Re-read data attributes from the morphed element
        this.#reinitializeAfterMorph();
      });
      return;
    }

    // Get variant ID from the event
    const variantId = event.detail?.resource?.id;
    if (!variantId) {
      // If no variant ID in event, try syncing from URL instead
      this.#syncFromUrl();
      return;
    }

    // Find the combination matching this variant
    const matchingCombination = this.#combinations.find(
      (c) => c.variantId && c.variantId.toString().trim() === variantId.toString().trim()
    );

    if (!matchingCombination) {
      // Variant not found in our combinations, try URL sync as fallback
      this.#syncFromUrl();
      return;
    }

    // Update current product URL if it changed
    const newProductUrl = matchingCombination.productUrl?.split('?')[0];
    if (newProductUrl && newProductUrl !== this.#currentProductUrl) {
      this.#currentProductUrl = newProductUrl;
    }

    // Update selections if they differ from current
    const newColor = matchingCombination.color?.trim();
    const newSize = matchingCombination.size?.trim();

    let colorChanged = false;
    let sizeChanged = false;

    if (newColor && newColor !== this.#selectedColor) {
      this.#selectedColor = newColor;
      colorChanged = true;
      // Find and check the matching color input
      const colorInput = this.querySelector(
        `.variant-picker-cl-dual__options[data-option-type="color"] input[value="${CSS.escape(newColor)}"]`
      );
      if (colorInput instanceof HTMLInputElement) {
        colorInput.checked = true;
        this.#updateSelectedOption(colorInput);
      }
    }

    if (newSize && newSize !== this.#selectedSize) {
      this.#selectedSize = newSize;
      sizeChanged = true;
      // Find and check the matching size input
      const sizeInput = this.querySelector(
        `.variant-picker-cl-dual__options[data-option-type="size"] input[value="${CSS.escape(newSize)}"]`
      );
      if (sizeInput instanceof HTMLInputElement) {
        sizeInput.checked = true;
        this.#updateSelectedOption(sizeInput);
      }
    }

    // Update filtering after sync if selections changed
    if (colorChanged || sizeChanged) {
      this.#updateFiltering();
    }
  }

  /**
   * Syncs the picker state from the current URL.
   * Reads variant parameter and updates selections accordingly.
   */
  #syncFromUrl() {
    const url = new URL(window.location.href);
    const variantParam = url.searchParams.get('variant');

    if (!variantParam) return;

    // Find the combination matching this variant
    const matchingCombination = this.#combinations.find(
      (c) => c.variantId && c.variantId.trim() === variantParam.trim()
    );

    if (!matchingCombination) return;

    // Update current product URL if it changed
    const newProductUrl = matchingCombination.productUrl?.split('?')[0];
    if (newProductUrl && newProductUrl !== this.#currentProductUrl) {
      this.#currentProductUrl = newProductUrl;
    }

    // Update selections if they differ from current
    const newColor = matchingCombination.color?.trim();
    const newSize = matchingCombination.size?.trim();

    let colorChanged = false;
    let sizeChanged = false;

    if (newColor && newColor !== this.#selectedColor) {
      this.#selectedColor = newColor;
      colorChanged = true;
      // Find and check the matching color input
      const colorInput = this.querySelector(
        `.variant-picker-cl-dual__options[data-option-type="color"] input[value="${CSS.escape(newColor)}"]`
      );
      if (colorInput instanceof HTMLInputElement) {
        colorInput.checked = true;
        this.#updateSelectedOption(colorInput);
      }
    }

    if (newSize && newSize !== this.#selectedSize) {
      this.#selectedSize = newSize;
      sizeChanged = true;
      // Find and check the matching size input
      const sizeInput = this.querySelector(
        `.variant-picker-cl-dual__options[data-option-type="size"] input[value="${CSS.escape(newSize)}"]`
      );
      if (sizeInput instanceof HTMLInputElement) {
        sizeInput.checked = true;
        this.#updateSelectedOption(sizeInput);
      }
    }

    // Update filtering after URL sync if selections changed
    if (colorChanged || sizeChanged) {
      this.#updateFiltering();
    }
  }

  /**
   * Parses the combinations data string into an array of objects.
   * Format: product_id|variant_id|color_value|size_value|product_url|available|is_current
   * @param {string} dataString - The combinations data string.
   * @returns {Array<{productId: string, variantId: string, color: string, size: string, productUrl: string, available: boolean, isCurrent: boolean}>} Array of combination objects.
   */
  #parseCombinations(dataString) {
    if (!dataString) return [];

    const entries = dataString.split('|||');
    return entries
      .map((entry) => {
        const parts = entry.split('|');
        if (parts.length >= 7) {
          return {
            productId: parts[0],
            variantId: parts[1],
            color: parts[2],
            size: parts[3],
            productUrl: parts[4],
            available: parts[5] === 'true',
            isCurrent: parts[6] === 'true',
          };
        }
        return null;
      })
      .filter(
        /**
         * @param {Object | null} entry
         * @returns {entry is {productId: string, variantId: string, color: string, size: string, productUrl: string, available: boolean, isCurrent: boolean}}
         */
        (entry) => entry !== null
      );
  }

  /**
   * Handles selection change events.
   * @param {Event} event - The change event.
   */
  #handleSelectionChange(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.target.type !== 'radio') return;

    const optionType = event.target.dataset.optionType;
    const value = event.target.value;

    if (optionType === 'color') {
      this.#selectedColor = value;
    } else if (optionType === 'size') {
      this.#selectedSize = value;
    }

    // If both are selected, dispatch VariantSelectedEvent FIRST to disable buttons
    // Then update UI, then navigate (matching variant-main-picker order)
    if (this.#selectedColor && this.#selectedSize) {
      // Find matching combination to get variantId
      const selectedColorTrimmed = this.#selectedColor?.trim().toLowerCase() || '';
      const selectedSizeTrimmed = this.#selectedSize?.trim().toLowerCase() || '';
      const matchingCombination = this.#combinations.find(
        (combo) =>
          combo.color?.trim().toLowerCase() === selectedColorTrimmed &&
          combo.size?.trim().toLowerCase() === selectedSizeTrimmed
      );

      if (matchingCombination) {
        // Step 1: Disable buttons FIRST (before UI updates)
        // Use requestAnimationFrame to ensure buttons disable in current frame
        this.dispatchEvent(
          new VariantSelectedEvent({
            id: matchingCombination.variantId,
          })
        );

        // Step 2: Defer UI updates to next frame (after buttons are disabled)
        const targetInput = event.target;
        requestAnimationFrame(() => {
          if (!(targetInput instanceof HTMLInputElement)) return;

          // Update pill animation state (after buttons are disabled)
          this.#updateSelectedOption(targetInput);

          // Update filtering
          this.#updateFiltering();

          // Navigate to matching product (async fetch happens after UI updates)
          this.#navigateToMatchingProduct();
        });
        return; // Exit early to prevent duplicate execution
      }
    }

    // If not both selected, update UI immediately (no button disabling needed)
    // Update pill animation state
    if (event.target instanceof HTMLInputElement) {
      this.#updateSelectedOption(event.target);
    }

    // Update filtering
    this.#updateFiltering();
  }

  /**
   * Updates the selected option state for pill animation.
   * Uses shared logic from variant-picker.js
   * @param {HTMLInputElement} target - The target input element.
   */
  #updateSelectedOption(target) {
    const fieldsetIndex = Number.parseInt(target.dataset.fieldsetIndex || '');
    const inputIndex = Number.parseInt(target.dataset.inputIndex || '');

    if (!Number.isNaN(fieldsetIndex) && !Number.isNaN(inputIndex)) {
      const optionsContainer = target.closest('.variant-picker-cl-dual__options');
      const checkedIndices = this.#checkedIndices[fieldsetIndex];
      const radios = this.#radios[fieldsetIndex];

      if (radios && checkedIndices && optionsContainer instanceof HTMLElement) {
        // Use shared pill animation logic from variant-picker.js
        updateSelectedOptionPillAnimation(radios, checkedIndices, inputIndex, optionsContainer);
      }
    }
    target.checked = true;
  }

  /**
   * Reinitializes the component after morphing with new data from the page.
   */
  #reinitializeAfterMorph() {
    // Re-read combinations data from data attribute
    const combinationsData = this.dataset.combinations;
    if (combinationsData) {
      this.#combinations = this.#parseCombinations(combinationsData);
    }

    // Update selected color and size from new page state
    this.#selectedColor = this.dataset.currentColor || undefined;
    this.#selectedSize = this.dataset.currentSize || undefined;

    // Re-initialize radio tracking for pill animation
    this.#checkedIndices = [];
    this.#radios = [];
    const optionsContainers = this.querySelectorAll('.variant-picker-cl-dual__options[data-fieldset-index]');
    optionsContainers.forEach((container) => {
      const radios = Array.from(container.querySelectorAll('input[type="radio"]')).filter(
        /**
         * @param {Element} el
         * @returns {el is HTMLInputElement}
         */
        (el) => el instanceof HTMLInputElement
      );
      this.#radios.push(radios);

      const initialCheckedIndex = radios.findIndex((radio) => radio.dataset.currentChecked === 'true');
      if (initialCheckedIndex !== -1) {
        this.#checkedIndices.push([initialCheckedIndex]);
      } else {
        this.#checkedIndices.push([]);
      }
    });

    // Re-run filtering with updated data
    this.#updateFiltering();

    // Sync from URL after reinitialization to ensure picker matches URL state
    this.#syncFromUrl();
  }

  /**
   * Updates the filtering of options based on current selections.
   */
  #updateFiltering() {
    // Get available colors and sizes based on current selections
    const availableColors = this.#getAvailableColors();
    const availableSizes = this.#getAvailableSizes();

    // Update color options
    const colorLabels = this.querySelectorAll(
      '.variant-picker-cl-dual__options[data-option-type="color"] > .variant-picker-cl-dual__label'
    );
    colorLabels.forEach((label) => {
      const input = label.querySelector('input[data-option-type="color"]');
      if (!(input instanceof HTMLInputElement)) return;

      const colorValue = input.value.trim();
      const isAvailable = availableColors.some((c) => c.trim() === colorValue);
      const isSelected = this.#selectedColor && this.#selectedColor.trim() === colorValue;

      // Check if this color has the selected size available (if a size is selected)
      let hasSelectedSize = true;
      if (this.#selectedSize) {
        const selectedSizeTrimmed = this.#selectedSize.trim();
        hasSelectedSize = this.#combinations.some(
          (c) =>
            c.color &&
            c.color.trim() === colorValue &&
            c.size &&
            c.size.trim() === selectedSizeTrimmed
        );
      }

      // Color is available if it's in the available colors list AND has the selected size (if size is selected)
      const colorIsAvailable = isAvailable && hasSelectedSize;

      // Update data-option-available attribute on both input and label
      input.setAttribute('data-option-available', colorIsAvailable.toString());
      label.setAttribute('data-option-available', colorIsAvailable.toString());
      if (!colorIsAvailable) {
        input.setAttribute('aria-disabled', 'true');
      } else {
        input.removeAttribute('aria-disabled');
      }

      // Disable if not available (unless it's the currently selected one)
      if (!colorIsAvailable && !isSelected) {
        label.setAttribute('data-disabled', 'true');
        input.disabled = true;
      } else {
        label.removeAttribute('data-disabled');
        input.disabled = false;
      }
    });

    // Update size options
    const sizeLabels = this.querySelectorAll(
      '.variant-picker-cl-dual__options[data-option-type="size"] > .variant-picker-cl-dual__label'
    );
    sizeLabels.forEach((label) => {
      const input = label.querySelector('input[data-option-type="size"]');
      if (!(input instanceof HTMLInputElement)) return;

      const sizeValue = input.value.trim();
      const isAvailable = availableSizes.some((s) => s.trim() === sizeValue);
      const isSelected = this.#selectedSize && this.#selectedSize.trim() === sizeValue;

      // Check if this size has any available combinations
      const hasAvailableCombination = this.#combinations.some(
        (c) =>
          c.size &&
          c.size.trim() === sizeValue &&
          c.available === true &&
          (!this.#selectedColor || (c.color && c.color.trim() === this.#selectedColor.trim()))
      );

      // Update data-option-available attribute on both input and label
      input.setAttribute('data-option-available', hasAvailableCombination.toString());
      label.setAttribute('data-option-available', hasAvailableCombination.toString());
      if (!hasAvailableCombination) {
        input.setAttribute('aria-disabled', 'true');
      } else {
        input.removeAttribute('aria-disabled');
      }

      // Disable if not available (unless it's the currently selected one)
      if (!isAvailable && !isSelected) {
        label.setAttribute('data-disabled', 'true');
        input.disabled = true;
      } else {
        label.removeAttribute('data-disabled');
        input.disabled = false;
      }
    });
  }

  /**
   * Gets available colors based on current size selection.
   * @returns {Array<string>} Array of available color values.
   */
  #getAvailableColors() {
    if (!this.#selectedSize) {
      // If no size selected, all colors are available
      return [
        ...new Set(
          this.#combinations
            .map((c) => c.color)
            .filter(Boolean)
            .map((c) => c.trim())
        ),
      ];
    }

    // Return colors that have a combination with the selected size
    const selectedSizeTrimmed = this.#selectedSize.trim();
    return [
      ...new Set(
        this.#combinations
          .filter((c) => c.size && c.size.trim() === selectedSizeTrimmed)
          .map((c) => c.color)
          .filter(Boolean)
          .map((c) => c.trim())
      ),
    ];
  }

  /**
   * Gets available sizes based on current color selection.
   * @returns {Array<string>} Array of available size values.
   */
  #getAvailableSizes() {
    if (!this.#selectedColor) {
      // If no color selected, all sizes are available
      return [
        ...new Set(
          this.#combinations
            .map((c) => c.size)
            .filter(Boolean)
            .map((c) => c.trim())
        ),
      ];
    }

    // Return sizes that have a combination with the selected color
    const selectedColorTrimmed = this.#selectedColor.trim();
    return [
      ...new Set(
        this.#combinations
          .filter((c) => c.color && c.color.trim() === selectedColorTrimmed)
          .map((c) => c.size)
          .filter(Boolean)
          .map((c) => c.trim())
      ),
    ];
  }

  /**
   * Finds and navigates to the product matching both color and size selections.
   */
  #navigateToMatchingProduct() {
    if (!this.#selectedColor || !this.#selectedSize) return;

    // Find the matching combination (with trimmed comparison for robustness)
    const selectedColorTrimmed = this.#selectedColor.trim();
    const selectedSizeTrimmed = this.#selectedSize.trim();
    const matchingCombination = this.#combinations.find(
      (c) => c.color && c.color.trim() === selectedColorTrimmed && c.size && c.size.trim() === selectedSizeTrimmed
    );

    if (!matchingCombination) {
      return;
    }

    // Build product URL with variant
    const productUrl = `${matchingCombination.productUrl}?variant=${matchingCombination.variantId}`;
    const newProductUrl = matchingCombination.productUrl;
    const isDifferentProduct = this.#currentProductUrl !== newProductUrl;

    // Navigate using morphing
    this.#fetchAndMorphProduct(productUrl, isDifferentProduct, matchingCombination.variantId);

    // Update browser history
    const url = new URL(productUrl, window.location.origin);
    if (url.href !== window.location.href) {
      requestYieldCallback(() => {
        history.replaceState({}, '', url.toString());
      });
    }
  }

  /**
   * Fetches the updated product page and morphs the main content.
   * @param {string} productUrl - The product URL with variant parameter.
   * @param {boolean} isDifferentProduct - Whether this is a different product.
   * @param {string} variantId - The variant ID for the event.
   */
  #fetchAndMorphProduct(productUrl, isDifferentProduct, variantId) {
    // Abort any pending requests
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    fetch(productUrl, { signal: this.#abortController.signal })
      .then((response) => {
        return response.text();
      })
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        const main = document.querySelector('main');
        const newMain = html.querySelector('main');

        if (!main || !newMain) {
          throw new Error('No main element found in response');
        }

        // Get variant data from the response (matching variant-picker.js behavior)
        // Look for variant data in product-form-component or variant-picker script tag
        const variantScript =
          html.querySelector('variant-picker script[type="application/json"]')?.textContent ||
          html.querySelector('product-form-component script[type="application/json"]')?.textContent;

        let variantData = null;
        if (variantScript) {
          try {
            variantData = JSON.parse(variantScript);
          } catch (e) {
            // Silently handle parse errors
          }
        }

        // Get product ID from the new HTML
        const newProductForm = html.querySelector('product-form-component');
        const newProductId =
          (newProductForm instanceof HTMLElement ? newProductForm.dataset.productId : null) || this.dataset.productId;

        // Determine if product changed
        const productUrlBase = productUrl.split('?')[0];
        const newProduct =
          isDifferentProduct && newProductId && newProductId !== this.dataset.productId && productUrlBase
            ? { id: newProductId, url: productUrlBase }
            : undefined;

        // Morph the entire main content
        morph(main, newMain);

        // Update current product URL
        this.#currentProductUrl = productUrl.split('?')[0];

        // Dispatch VariantUpdateEvent to re-enable buttons (matching variant-main-picker behavior)
        // Use the variantId as sourceId (similar to how variant-picker uses selectedOptionId)
        this.dispatchEvent(
          new VariantUpdateEvent(variantData, variantId || '', {
            html,
            productId: newProductId || this.dataset.productId || '',
            newProduct,
          })
        );

        // After morphing, reinitialize with new data from the morphed element
        // Use requestYieldCallback to ensure DOM is fully updated
        requestYieldCallback(() => {
          // Find the picker element after morphing (might be same instance or new one)
          const pickerElement = document.querySelector(
            `variant-picker-cl-dual[data-section-id="${this.dataset.sectionId}"][data-block-id="${this.dataset.blockId}"]`
          );

          if (pickerElement && pickerElement instanceof VariantPickerCLDual) {
            // Re-read data attributes and reinitialize
            pickerElement.#reinitializeAfterMorph();
          } else {
            // If element not found, it might be a new instance that hasn't initialized yet
            // The connectedCallback will handle initialization, but we should still try to find and update it
            setTimeout(() => {
              const delayedPickerElement = document.querySelector(
                `variant-picker-cl-dual[data-section-id="${this.dataset.sectionId}"][data-block-id="${this.dataset.blockId}"]`
              );
              if (delayedPickerElement && delayedPickerElement instanceof VariantPickerCLDual) {
                delayedPickerElement.#reinitializeAfterMorph();
              }
            }, 100);
          }
        });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          // Silently handle errors
        }
      });
  }
}

if (!customElements.get('variant-picker-cl-dual')) {
  customElements.define('variant-picker-cl-dual', VariantPickerCLDual);
}
