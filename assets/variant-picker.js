import { Component } from '@theme/component';
import { VariantSelectedEvent, VariantUpdateEvent } from '@theme/events';
import { morph } from '@theme/morph';
import { requestYieldCallback, getViewParameterValue } from '@theme/utilities';

/**
 * @typedef {object} VariantPickerRefs
 * @property {HTMLFieldSetElement[]} fieldsets – The fieldset elements.
 */

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [TRefs=VariantPickerRefs]
 * @extends Component<TRefs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {number[][]} */
  #checkedIndices = [];

  /** @type {HTMLInputElement[][]} */
  #radios = [];

  /** @type {(() => void) | undefined} */
  #boundHandleUrlChange;

  connectedCallback() {
    super.connectedCallback();
    const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);

    fieldsets.forEach((fieldset) => {
      const radios = Array.from(fieldset?.querySelectorAll('input') ?? []);
      this.#radios.push(radios);

      const initialCheckedIndex = radios.findIndex((radio) => radio.dataset.currentChecked === 'true');
      if (initialCheckedIndex !== -1) {
        this.#checkedIndices.push([initialCheckedIndex]);
      }
    });

    this.addEventListener('change', this.variantChanged.bind(this));

    // Listen for URL changes (browser back/forward navigation) - only on product pages
    const isOnProductPage =
      this.dataset.templateProductMatch === 'true' &&
      !this.closest('product-card') &&
      !this.closest('quick-add-dialog');
    if (isOnProductPage) {
      this.#boundHandleUrlChange = this.#handleUrlChange.bind(this);
      window.addEventListener('popstate', this.#boundHandleUrlChange);
      // Check URL on initial load to sync with URL parameters
      this.#syncFromUrl();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.#boundHandleUrlChange !== undefined) {
      window.removeEventListener('popstate', this.#boundHandleUrlChange);
      this.#boundHandleUrlChange = undefined;
    }
  }

  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const selectedOption =
      event.target instanceof HTMLSelectElement ? event.target.options[event.target.selectedIndex] : event.target;

    if (!selectedOption) return;

    this.updateSelectedOption(event.target);
    this.dispatchEvent(new VariantSelectedEvent({ id: selectedOption.dataset.optionValueId ?? '' }));

    const isOnProductPage =
      this.dataset.templateProductMatch === 'true' &&
      !event.target.closest('product-card') &&
      !event.target.closest('quick-add-dialog');

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split('?')[0];
    const newUrl = selectedOption.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;

    this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), loadsNewProduct);

    const url = new URL(window.location.href);

    const variantId = selectedOption.dataset.variantId || null;

    if (isOnProductPage) {
      if (variantId) {
        url.searchParams.set('variant', variantId);
      } else {
        url.searchParams.delete('variant');
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      requestYieldCallback(() => {
        history.replaceState({}, '', url.toString());
      });
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === 'string') {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error('Target element not found');

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      const fieldsetIndex = Number.parseInt(target.dataset.fieldsetIndex || '');
      const inputIndex = Number.parseInt(target.dataset.inputIndex || '');

      if (!Number.isNaN(fieldsetIndex) && !Number.isNaN(inputIndex)) {
        const fieldsets = /** @type {HTMLFieldSetElement[]} */ (this.refs.fieldsets || []);
        const fieldset = fieldsets[fieldsetIndex];
        const checkedIndices = this.#checkedIndices[fieldsetIndex];
        const radios = this.#radios[fieldsetIndex];

        if (radios && checkedIndices && fieldset) {
          // Clear previous checked states
          const [currentIndex, previousIndex] = checkedIndices;

          if (currentIndex !== undefined && radios[currentIndex]) {
            radios[currentIndex].dataset.previousChecked = 'false';
          }
          if (previousIndex !== undefined && radios[previousIndex]) {
            radios[previousIndex].dataset.previousChecked = 'false';
          }

          // Update checked indices array - keep only the last 2 selections
          checkedIndices.unshift(inputIndex);
          checkedIndices.length = Math.min(checkedIndices.length, 2);

          // Update the new states
          const newCurrentIndex = checkedIndices[0]; // This is always inputIndex
          const newPreviousIndex = checkedIndices[1]; // This might be undefined

          // newCurrentIndex is guaranteed to exist since we just added it
          if (newCurrentIndex !== undefined && radios[newCurrentIndex]) {
            radios[newCurrentIndex].dataset.currentChecked = 'true';
            fieldset.style.setProperty(
              '--pill-width-current',
              `${radios[newCurrentIndex].parentElement?.offsetWidth || 0}px`
            );
          }

          if (newPreviousIndex !== undefined && radios[newPreviousIndex]) {
            radios[newPreviousIndex].dataset.previousChecked = 'true';
            radios[newPreviousIndex].dataset.currentChecked = 'false';
            fieldset.style.setProperty(
              '--pill-width-previous',
              `${radios[newPreviousIndex].parentElement?.offsetWidth || 0}px`
            );
          }
        }
      }
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error('Option not found');

      for (const option of target.options) {
        option.removeAttribute('selected');
      }

      newSelectedOption.setAttribute('selected', 'selected');
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];
    const viewParamValue = getViewParameterValue();

    // preserve view parameter, if it exists, for alternative product view testing
    if (viewParamValue) params.push(`view=${viewParamValue}`);

    if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(',')}`);
    } else if (source === 'product-card') {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(',')}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of quick-add-component or swatches-variant-picker-component, we need to append section_id=section-rendering-product-card to the URL
    if (this.closest('quick-add-component') || this.closest('swatches-variant-picker-component')) {
      if (productUrl?.includes('?')) {
        productUrl = productUrl.split('?')[0];
      }
      return `${productUrl}?section_id=section-rendering-product-card&${params.join('&')}`;
    }
    return `${productUrl}?${params.join('&')}`;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {boolean} shouldMorphMain - If the entire main content should be morphed. By default, only the variant picker is morphed.
   */
  fetchUpdatedSection(requestUrl, shouldMorphMain = false) {
    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    fetch(requestUrl, { signal: this.#abortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        this.#pendingRequestUrl = undefined;
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        // Defer is only useful for the initial rendering of the page. Remove it here.
        html.querySelector('overflow-list[defer]')?.removeAttribute('defer');

        // Look for variant data in either variant-picker or swatches-variant-picker-component
        const textContent =
          html.querySelector(`variant-picker script[type="application/json"]`)?.textContent ||
          html.querySelector(`swatches-variant-picker-component script[type="application/json"]`)?.textContent;

        // If no variant data found, try to get it from the selected option directly
        let variantData = null;
        if (textContent) {
          try {
            variantData = JSON.parse(textContent);
          } catch (e) {
            // Silently handle parse errors
          }
        }

        // If still no variant data, try to construct it from the selected option
        if (!variantData && this.selectedOption) {
          const variantId = this.selectedOption.dataset.variantId;
          if (variantId) {
            // Create a minimal variant object for the event
            variantData = { id: variantId };
          }
        }

        // CRITICAL: For product cards with pending variant ID, use that instead
        // This ensures the correct variant ID is used for featured image swatches
        // The fetched HTML might have the default variant, not the one we want
        if (this.pendingVariantId) {
          if (!variantData) {
            variantData = { id: this.pendingVariantId };
          } else {
            // Override the variant ID from fetched HTML with the pending one
            variantData.id = this.pendingVariantId;
          }
        }

        if (!variantData) return;

        if (shouldMorphMain) {
          this.updateMain(html);
        } else {
          let newProduct;
          try {
            newProduct = this.updateVariantPicker(html);
          } catch (error) {
            // If variant picker update fails, still dispatch the event so quick add and other features work
            console.warn('Variant picker update failed, but continuing with variant update event:', error);
          }

          // We grab the variant object from the response and dispatch an event with it.
          if (this.selectedOptionId) {
            this.dispatchEvent(
              new VariantUpdateEvent(variantData, this.selectedOptionId, {
                html,
                productId: this.dataset.productId ?? '',
                newProduct,
              })
            );
            
            // Clear pending variant ID after use
            this.pendingVariantId = undefined;
          }
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          console.warn('Fetch aborted by user');
        } else {
          console.error(error);
        }
      });
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    /** @type {NewProduct | undefined} */
    let newProduct;

    // Try to find the variant picker by tag name (works for both variant-picker and swatches-variant-picker-component)
    let newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    // If not found, try finding it within a product-card (for product card swatches)
    if (!newVariantPickerSource) {
      const productCard = newHtml.querySelector('product-card');
      if (productCard) {
        newVariantPickerSource = productCard.querySelector(this.tagName.toLowerCase());
      }
    }

    if (!newVariantPickerSource) {
      throw new Error(`No new variant picker source found for ${this.tagName.toLowerCase()}`);
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    morph(this, newVariantPickerSource);

    return newProduct;
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector('main');
    const newMain = newHtml.querySelector('main');

    if (!main || !newMain) {
      throw new Error('No new main source found');
    }

    morph(main, newMain);
  }

  /**
   * Gets the selected option.
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption = this.querySelector('select option[selected], fieldset input:checked');

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error('No option value ID found');
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(this.querySelectorAll('select option[selected], fieldset input:checked'));

    return selectedOptions.map((option) => {
      const { optionValueId } = option.dataset;

      if (!optionValueId) throw new Error('No option value ID found');

      return optionValueId;
    });
  }

  /**
   * Handles URL changes (browser back/forward navigation).
   */
  #handleUrlChange() {
    this.#syncFromUrl();
  }

  /**
   * Syncs the picker state from the current URL.
   * Reads variant parameter and product path, then updates selection or navigates.
   */
  #syncFromUrl() {
    const url = new URL(window.location.href);
    const variantParam = url.searchParams.get('variant');
    const currentProductUrl = this.dataset.productUrl?.split('?')[0];
    const newProductUrl = url.pathname;

    // Check if we're navigating to a different product
    const isDifferentProduct = currentProductUrl && newProductUrl !== currentProductUrl;

    if (isDifferentProduct) {
      // Different product - find the option that matches this product URL and variant
      const matchingOption = this.#findOptionByUrlAndVariant(newProductUrl, variantParam);
      if (matchingOption) {
        // Trigger selection change to navigate
        if (matchingOption instanceof HTMLInputElement) {
          matchingOption.checked = true;
          matchingOption.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (matchingOption instanceof HTMLOptionElement) {
          const select = matchingOption.closest('select');
          if (select instanceof HTMLSelectElement) {
            select.selectedIndex = Array.from(select.options).indexOf(matchingOption);
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
      return;
    }

    // Same product - just update the selected option to match the variant
    if (variantParam) {
      const matchingOption = this.#findOptionByVariantId(variantParam);
      if (matchingOption) {
        if (matchingOption instanceof HTMLInputElement) {
          matchingOption.checked = true;
          this.updateSelectedOption(matchingOption);
        } else if (matchingOption instanceof HTMLOptionElement) {
          const select = matchingOption.closest('select');
          if (select instanceof HTMLSelectElement) {
            select.selectedIndex = Array.from(select.options).indexOf(matchingOption);
            this.updateSelectedOption(select);
          }
        }
      }
    }
  }

  /**
   * Finds an option element by variant ID.
   * @param {string} variantId - The variant ID to find.
   * @returns {HTMLInputElement | HTMLOptionElement | null} The matching option element.
   */
  #findOptionByVariantId(variantId) {
    // Try radio inputs first
    const radioInput = this.querySelector(`input[type="radio"][data-variant-id="${CSS.escape(variantId)}"]`);
    if (radioInput instanceof HTMLInputElement) {
      return radioInput;
    }

    // Try option elements in selects
    const optionElement = this.querySelector(`option[data-variant-id="${CSS.escape(variantId)}"]`);
    if (optionElement instanceof HTMLOptionElement) {
      return optionElement;
    }

    // Try by value (for swatches that use variant ID as value)
    const inputByValue = this.querySelector(`input[type="radio"][value="${CSS.escape(variantId)}"]`);
    if (inputByValue instanceof HTMLInputElement) {
      return inputByValue;
    }

    return null;
  }

  /**
   * Finds an option element by product URL and variant ID.
   * @param {string} productUrl - The product URL to match.
   * @param {string | null} variantId - The variant ID to match.
   * @returns {HTMLInputElement | HTMLOptionElement | null} The matching option element.
   */
  #findOptionByUrlAndVariant(productUrl, variantId) {
    // Find options that have connectedProductUrl matching the product URL
    const allOptions = this.querySelectorAll(
      'input[type="radio"][data-connected-product-url], option[data-connected-product-url]'
    );

    for (const option of allOptions) {
      const connectedUrl = option.dataset.connectedProductUrl?.split('?')[0];
      if (connectedUrl === productUrl) {
        // If variant ID is specified, also check it matches
        if (variantId) {
          const optionVariantId = option.dataset.variantId || option.value;
          if (optionVariantId === variantId) {
            return option instanceof HTMLInputElement || option instanceof HTMLOptionElement ? option : null;
          }
        } else {
          // No variant ID specified, return first matching option
          return option instanceof HTMLInputElement || option instanceof HTMLOptionElement ? option : null;
        }
      }
    }

    return null;
  }
}

if (!customElements.get('variant-picker')) {
  customElements.define('variant-picker', VariantPicker);
}
