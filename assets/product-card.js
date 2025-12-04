import { OverflowList } from '@theme/critical';
import VariantPicker from '@theme/variant-picker';
import { Component } from '@theme/component';
import { debounce, isDesktopBreakpoint, mediaQueryLarge, requestYieldCallback } from '@theme/utilities';
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent, SlideshowSelectEvent } from '@theme/events';
import { morph } from '@theme/morph';

/**
 * A custom element that displays a product card.
 *
 * @typedef {object} Refs
 * @property {HTMLAnchorElement} productCardLink - The product card link element.
 * @property {import('slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {import('quick-add').QuickAddComponent} [quickAdd] - The quick add component.
 * @property {HTMLElement} [cardGallery] - The card gallery component.
 *
 * @extends {Component<Refs>}
 */
export class ProductCard extends Component {
  requiredRefs = ['productCardLink'];

  get productPageUrl() {
    return this.refs.productCardLink.href;
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null if none selected
   */
  getSelectedVariantId() {
    const checkedInput = /** @type {HTMLInputElement | null} */ (
      this.querySelector('input[type="radio"]:checked[data-variant-id]')
    );

    return checkedInput?.dataset.variantId || null;
  }

  /**
   * Gets the product card link element
   * @returns {HTMLAnchorElement | null} The product card link or null
   */
  getProductCardLink() {
    return this.refs.productCardLink || null;
  }

  #fetchProductPageHandler = () => {
    this.refs.quickAdd?.fetchProductPage(this.productPageUrl);
  };

  /**
   * Navigates to a URL link. Respects modifier keys for opening in new tab/window.
   * @param {Event} event - The event that triggered the navigation.
   * @param {URL} url - The URL to navigate to.
   */
  #navigateToURL = (event, url) => {
    // Check for modifier keys that should open in new tab/window (only for mouse events)
    const shouldOpenInNewTab =
      event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1);

    if (shouldOpenInNewTab) {
      event.preventDefault();
      window.open(url.href, '_blank');
      return;
    } else {
      window.location.href = url.href;
    }
  };

  connectedCallback() {
    super.connectedCallback();

    const link = this.refs.productCardLink;
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Product card link not found');
    this.#handleQuickAdd();

    this.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
    this.addEventListener(ThemeEvents.variantSelected, this.#handleVariantSelected);
    this.addEventListener(SlideshowSelectEvent.eventName, this.#handleSlideshowSelect);
    mediaQueryLarge.addEventListener('change', this.#handleQuickAdd);

    this.addEventListener('click', this.navigateToProduct);

    // Preload the next image on the slideshow to avoid white flashes on previewImage
    setTimeout(() => {
      if (this.refs.slideshow?.isNested) {
        this.#preloadNextPreviewImage();
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.navigateToProduct);
  }

  #preloadNextPreviewImage() {
    const currentSlide = this.refs.slideshow?.slides?.[this.refs.slideshow?.current];
    currentSlide?.nextElementSibling?.querySelector('img[loading="lazy"]')?.removeAttribute('loading');
  }

  /**
   * Handles the quick add event.
   */
  #handleQuickAdd = () => {
    this.removeEventListener('pointerenter', this.#fetchProductPageHandler);
    this.removeEventListener('focusin', this.#fetchProductPageHandler);

    if (isDesktopBreakpoint()) {
      this.addEventListener('pointerenter', this.#fetchProductPageHandler);
      this.addEventListener('focusin', this.#fetchProductPageHandler);
    }
  };

  /**
   * Handles the variant selected event.
   * @param {VariantSelectedEvent} event - The variant selected event.
   */
  #handleVariantSelected = (event) => {
    if (event.target !== this.variantPicker) {
      this.variantPicker?.updateSelectedOption(event.detail.resource.id);
    }
  };

  /**
   * Handles the variant update event.
   * Updates price, checks for unavailable variants, and updates product URL.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #handleVariantUpdate = (event) => {
    // Stop the event from bubbling up to the section, variant updates triggered from product cards are fully handled
    // by this component and should not affect anything outside the card.
    event.stopPropagation();

    this.updatePrice(event);
    this.#isUnavailableVariantSelected(event);
    this.#updateProductUrl(event);
    this.refs.quickAdd?.fetchProductPage(this.productPageUrl);

    if (event.target !== this.variantPicker) {
      this.variantPicker?.updateVariantPicker(event.detail.data.html);
    }

    // Check if this is a combined listing product change (new product)
    const newProduct = event.detail.data?.newProduct;
    if (newProduct) {
      // Product changed - update the entire product card gallery/slideshow
      this.#updateProductCardImages(event);
    } else {
      // Same product, just variant changed - update variant images only
      this.#updateVariantImages();
    }
    this.#previousSlideIndex = null;

    // Remove attribute after re-rendering since a variant selection has been made
    this.removeAttribute('data-no-swatch-selected');

    // Force overflow list to reflow after variant update
    // This fixes an issue where the overflow counter doesn't update properly in some browsers
    this.#updateOverflowList();
  };

  /**
   * Forces the overflow list to recalculate by dispatching a reflow event.
   * This ensures the overflow counter displays correctly after variant updates.
   */
  #updateOverflowList() {
    // Find the overflow list in the variant picker
    const overflowList = this.querySelector('swatches-variant-picker-component overflow-list');
    const isActiveOverflowList = overflowList?.querySelector('[slot="overflow"]') ? true : false;
    if (!overflowList || !isActiveOverflowList) return;

    // Use requestAnimationFrame to ensure DOM has been updated
    requestAnimationFrame(() => {
      // Dispatch a reflow event to trigger recalculation
      overflowList.dispatchEvent(
        new CustomEvent('reflow', {
          bubbles: true,
          detail: {},
        })
      );
    });
  }

  /**
   * Updates the DOM with a new price.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updatePrice(event) {
    const priceContainer = this.querySelectorAll(`product-price [ref='priceContainer']`)[1];
    const newPriceElement = event.detail.data.html.querySelector(`product-price [ref='priceContainer']`);

    if (newPriceElement && priceContainer) {
      morph(priceContainer, newPriceElement);
    }
  }

  /**
   * Updates the product URL based on the variant update event.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #updateProductUrl(event) {
    const anchorElement = event.detail.data.html?.querySelector('product-card a');
    const featuredMediaUrl = event.detail.data.html
      ?.querySelector('product-card-link')
      ?.getAttribute('data-featured-media-url');

    // If the product card is inside a product link, update the product link's featured media URL
    if (featuredMediaUrl && this.closest('product-card-link'))
      this.closest('product-card-link')?.setAttribute('data-featured-media-url', featuredMediaUrl);

    if (anchorElement instanceof HTMLAnchorElement) {
      // If the href is empty, don't update the product URL eg: unavailable variant
      if (anchorElement.getAttribute('href')?.trim() === '') return;

      const productUrl = anchorElement.href;
      const { productCardLink, productTitleLink, cardGalleryLink } = this.refs;

      productCardLink.href = productUrl;
      if (cardGalleryLink instanceof HTMLAnchorElement) {
        cardGalleryLink.href = productUrl;
      }
      if (productTitleLink instanceof HTMLAnchorElement) {
        productTitleLink.href = productUrl;
      }
    }
  }

  /**
   * Checks if an unavailable variant is selected.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #isUnavailableVariantSelected(event) {
    const allVariants = /** @type {NodeListOf<HTMLInputElement>} */ (
      event.detail.data.html.querySelectorAll('input:checked')
    );

    for (const variant of allVariants) {
      this.#toggleAddToCartButton(variant.dataset.optionAvailable === 'true');
    }
  }

  /**
   * Toggles the add to cart button state.
   * @param {boolean} enable - Whether to enable or disable the button.
   */
  #toggleAddToCartButton(enable) {
    const addToCartButton = this.querySelector('.add-to-cart__button button');

    if (addToCartButton instanceof HTMLButtonElement) {
      addToCartButton.disabled = !enable;
    }
  }

  /**
   * Updates the product card images when the product changes (combined listings).
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #updateProductCardImages(event) {
    const html = event.detail.data?.html;
    if (!html) return;

    // Find the new product card in the response
    const newProductCard = html.querySelector('product-card');
    if (!newProductCard) return;

    // Find the new product card's gallery/slideshow
    const newCardGallery = newProductCard.querySelector('card-gallery, .card-gallery');
    const currentCardGallery = this.querySelector('card-gallery, .card-gallery');

    if (newCardGallery && currentCardGallery) {
      // Morph the gallery to update images
      morph(currentCardGallery, newCardGallery);
    }

    // Also update the slideshow if it exists
    const newSlideshow = newProductCard.querySelector('slideshow-component');
    const currentSlideshow = this.refs.slideshow;

    if (newSlideshow && currentSlideshow) {
      // Morph the slideshow to update all slides
      morph(currentSlideshow, newSlideshow);

      // Select the first slide (featured image of new product)
      requestYieldCallback(() => {
        if (currentSlideshow.slides && currentSlideshow.slides.length > 0) {
          currentSlideshow.select(0, undefined, { animate: false });
        }
      });
    }

    // Update product-card-link featured media URL if it exists
    const productCardLink = this.closest('product-card-link');
    if (productCardLink) {
      const newProductCardLink = html.querySelector('product-card-link');
      if (newProductCardLink) {
        const newFeaturedMediaUrl = newProductCardLink.getAttribute('data-featured-media-url');
        if (newFeaturedMediaUrl) {
          productCardLink.setAttribute('data-featured-media-url', newFeaturedMediaUrl);
        }
      }
    }
  }

  /**
   * Hide the variant images that are not for the selected variant.
   */
  #updateVariantImages() {
    const { slideshow } = this.refs;
    if (!this.variantPicker?.selectedOption) {
      return;
    }

    const selectedImageId = this.variantPicker?.selectedOption.dataset.optionMediaId;

    if (slideshow && selectedImageId) {
      const { slides = [] } = slideshow.refs;

      for (const slide of slides) {
        if (slide.getAttribute('variant-image') == null) continue;

        slide.hidden = slide.getAttribute('slide-id') !== selectedImageId;
      }

      slideshow.select({ id: selectedImageId }, undefined, { animate: false });
    }
  }

  /**
   * Gets all variant inputs.
   * @returns {NodeListOf<HTMLInputElement>} All variant input elements.
   */
  get allVariants() {
    return this.querySelectorAll('input[data-variant-id]');
  }

  /**
   * Gets the variant picker component.
   * @returns {VariantPicker | null} The variant picker component.
   */
  get variantPicker() {
    return this.querySelector('swatches-variant-picker-component');
  }
  /** @type {number | null} */
  #previousSlideIndex = null;

  /**
   * Handles the slideshow select event.
   * @param {SlideshowSelectEvent} event - The slideshow select event.
   */
  #handleSlideshowSelect = (event) => {
    if (event.detail.userInitiated) {
      this.#previousSlideIndex = event.detail.index;
    }
  };

  /**
   * Previews a variant.
   * @param {string} id - The id of the variant to preview.
   * @param {PointerEvent} [event] - The pointer event that triggered the preview.
   */
  previewVariant(id, event) {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    this.resetVariant.cancel();
    slideshow.select({ id }, undefined, { animate: false });

    // Update badge visibility based on variant availability
    this.#updateBadgeVisibility(event);
  }

  /**
   * Previews the next image.
   * @param {PointerEvent} event - The pointer event.
   */
  previewImage(event) {
    if (event.pointerType !== 'mouse') return;

    const { slideshow } = this.refs;

    if (!slideshow) return;

    this.resetVariant.cancel();

    if (this.#previousSlideIndex != null && this.#previousSlideIndex > 0) {
      slideshow.select(this.#previousSlideIndex, undefined, { animate: false });
    } else {
      slideshow.next(undefined, { animate: false });
      setTimeout(() => this.#preloadNextPreviewImage());
    }
  }

  /**
   * Resets the image to the variant image.
   * @param {PointerEvent} event - The pointer event.
   */
  resetImage(event) {
    if (event.pointerType !== 'mouse') return;

    const { slideshow } = this.refs;

    if (!this.variantPicker) {
      if (!slideshow) return;
      slideshow.previous(undefined, { animate: false });
    } else {
      this.#resetVariant();
    }
  }

  /**
   * Resets the image to the variant image.
   */
  #resetVariant = () => {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    // If we have a selected variant, always use its image
    if (this.variantPicker?.selectedOption) {
      const id = this.variantPicker.selectedOption.dataset.optionMediaId;
      if (id) {
        slideshow.select({ id }, undefined, { animate: false });
        // Reset badge to product's default availability
        this.#resetBadgeVisibility();
        return;
      }
    }

    // No variant selected - use initial slide if it's valid
    const initialSlide = slideshow.initialSlide;
    const slideId = initialSlide?.getAttribute('slide-id');
    if (initialSlide && slideshow.slides?.includes(initialSlide) && slideId) {
      slideshow.select({ id: slideId }, undefined, { animate: false });
      // Reset badge to product's default availability
      this.#resetBadgeVisibility();
      return;
    }

    // No valid initial slide or selected variant - go to previous
    slideshow.previous(undefined, { animate: false });
    // Reset badge to product's default availability
    this.#resetBadgeVisibility();
  };

  /**
   * Updates the badge visibility based on the variant being previewed.
   * @param {PointerEvent} [event] - The pointer event that triggered the preview.
   */
  #updateBadgeVisibility(event) {
    const badgeContainer = this.querySelector('.product-badges');
    if (!badgeContainer) return;

    // Get availability from the label that triggered the event
    let isAvailable = true;
    if (event?.target) {
      // The event target might be the label itself or a child element
      const label =
        event.target.closest('label[data-option-available]') ||
        (event.target.tagName === 'LABEL' && event.target.hasAttribute('data-option-available') ? event.target : null);

      if (label) {
        const available = label.dataset.optionAvailable;
        isAvailable = available === 'true';
      } else {
        // Fallback: check the input element within the label
        const input = event.target.closest('label')?.querySelector('input[data-option-available]');
        if (input) {
          isAvailable = input.dataset.optionAvailable === 'true';
        }
      }
    }

    // Find or create the sold out badge
    let soldOutBadge = badgeContainer.querySelector('.product-badges__badge--sold-out-preview');

    if (!isAvailable) {
      // Show sold out badge
      if (!soldOutBadge) {
        // Create the badge if it doesn't exist
        soldOutBadge = document.createElement('div');
        soldOutBadge.className =
          'product-badges__badge product-badges__badge--rectangle product-badges__badge--sold-out-preview';

        // Get color scheme from badge container data attribute (set in Liquid template)
        const colorScheme = badgeContainer.dataset.badgeSoldOutColorScheme || 'scheme-5';
        soldOutBadge.classList.add(`color-${colorScheme}`);

        soldOutBadge.textContent = this.#getSoldOutText();
        badgeContainer.appendChild(soldOutBadge);
      }
      soldOutBadge.style.display = 'flex';

      // Hide other badges if they exist
      const otherBadges = badgeContainer.querySelectorAll(
        '.product-badges__badge:not(.product-badges__badge--sold-out-preview)'
      );
      otherBadges.forEach((badge) => {
        badge.style.display = 'none';
      });
    } else {
      // Hide sold out badge if variant is available
      if (soldOutBadge) {
        soldOutBadge.style.display = 'none';
      }

      // Show other badges
      const otherBadges = badgeContainer.querySelectorAll(
        '.product-badges__badge:not(.product-badges__badge--sold-out-preview)'
      );
      otherBadges.forEach((badge) => {
        badge.style.display = '';
      });
    }
  }

  /**
   * Resets the badge visibility to the product's default state.
   */
  #resetBadgeVisibility() {
    const badgeContainer = this.querySelector('.product-badges');
    if (!badgeContainer) return;

    // Hide the preview sold out badge
    const soldOutBadge = badgeContainer.querySelector('.product-badges__badge--sold-out-preview');
    if (soldOutBadge) {
      soldOutBadge.style.display = 'none';
    }

    // Show other badges (restore original state)
    const otherBadges = badgeContainer.querySelectorAll(
      '.product-badges__badge:not(.product-badges__badge--sold-out-preview)'
    );
    otherBadges.forEach((badge) => {
      badge.style.display = '';
    });
  }

  /**
   * Gets the sold out text from the theme translations.
   * @returns {string} The sold out text.
   */
  #getSoldOutText() {
    // Try to get from existing badge or use default
    const existingBadge = this.querySelector('.product-badges__badge');
    if (existingBadge && existingBadge.textContent.includes('Sold out')) {
      return existingBadge.textContent.trim();
    }
    // Try to get from theme translations
    const themeTranslations = window.Shopify?.theme?.translations;
    if (themeTranslations?.content?.product_badge_sold_out) {
      return themeTranslations.content.product_badge_sold_out;
    }
    // Fallback to common translations
    return 'Sold out';
  }

  /**
   * Intercepts the click event on the product card anchor, we want
   * to use this to add an intermediate state to the history.
   * This intermediate state captures the page we were on so that we
   * navigate back to the same page when the user navigates back.
   * In addition to that, it captures the product card anchor so that we
   * have the specific product card in view.
   *
   * A product card can have other interactive elements like variant picker,
   * so we do not navigate if the click was on one of those elements.
   *
   * @param {Event} event
   */
  navigateToProduct = (event) => {
    if (!(event.target instanceof Element)) return;

    // Don't navigate if this product card is marked as no-navigation (e.g., in theme editor)
    if (this.hasAttribute('data-no-navigation')) return;

    const interactiveElement = event.target.closest('button, input, label, select, [tabindex="1"]');

    // If the click was on an interactive element, do nothing.
    if (interactiveElement) {
      return;
    }

    const link = this.refs.productCardLink;
    if (!link.href) return;
    const linkURL = new URL(link.href);

    const productCardAnchor = link.getAttribute('id');
    if (!productCardAnchor) return;

    const url = new URL(window.location.href);
    const parent = this.closest('li');
    url.hash = productCardAnchor;
    if (parent && parent.dataset.page) {
      url.searchParams.set('page', parent.dataset.page);
    }

    if (!window.Shopify.designMode) {
      requestYieldCallback(() => {
        history.replaceState({}, '', url.toString());
      });
    }

    const targetLink = event.target.closest('a');
    // Let the native navigation handle the click if it was on a link.
    if (!targetLink) {
      this.#navigateToURL(event, linkURL);
    }
  };

  /**
   * Resets the variant.
   */
  resetVariant = debounce(this.#resetVariant, 100);
}

if (!customElements.get('product-card')) {
  customElements.define('product-card', ProductCard);
}

/**
 * A custom element that displays a variant picker with swatches.
 * @typedef {import('@theme/variant-picker').VariantPickerRefs & {overflowList: HTMLElement}} SwatchesRefs
 */

/**
 * @extends {VariantPicker<SwatchesRefs>}
 */
class SwatchesVariantPickerComponent extends VariantPicker {
  connectedCallback() {
    super.connectedCallback();

    // Cache the parent product card
    this.parentProductCard = this.closest('product-card');

    // Listen for variant updates to apply pending URL changes
    this.addEventListener(ThemeEvents.variantUpdate, this.#handleCardVariantUrlUpdate.bind(this));
  }

  /**
   * Updates the card URL when a variant is selected.
   */
  #handleCardVariantUrlUpdate() {
    if (this.pendingVariantId && this.parentProductCard instanceof ProductCard) {
      const currentUrl = new URL(this.parentProductCard.refs.productCardLink.href);
      currentUrl.searchParams.set('variant', this.pendingVariantId);
      this.parentProductCard.refs.productCardLink.href = currentUrl.toString();
      this.pendingVariantId = null;
    }
  }

  /**
   * Override the variantChanged method to handle unavailable swatches with available alternatives.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    // Check if this is a swatch input
    const isSwatchInput = event.target instanceof HTMLInputElement && event.target.name?.includes('-swatch');
    const clickedSwatch = event.target;
    const availableCount = parseInt(clickedSwatch.dataset.availableCount || '0');
    const firstAvailableVariantId = clickedSwatch.dataset.firstAvailableOrFirstVariantId;

    // Check if this swatch points to a different product (combined listing)
    const connectedProductUrl = clickedSwatch.dataset.connectedProductUrl;
    const currentProductUrl = this.dataset.productUrl?.split('?')[0];
    const isDifferentProduct = connectedProductUrl && connectedProductUrl !== currentProductUrl;

    // For swatch inputs, check if we need special handling
    if (isSwatchInput && availableCount > 0 && firstAvailableVariantId) {
      // If this is an unavailable variant but there are available alternatives
      // Prevent the default handling
      event.stopPropagation();

      // Update the selected option visually
      this.updateSelectedOption(clickedSwatch);

      // Build request URL with the first available variant
      const productUrl = connectedProductUrl || this.dataset.productUrl?.split('?')[0];

      if (!productUrl) return;

      const url = new URL(productUrl, window.location.origin);
      url.searchParams.set('variant', firstAvailableVariantId);
      url.searchParams.set('section_id', 'section-rendering-product-card');

      const requestUrl = url.href;

      // Store the variant ID we want to apply to the URL
      this.pendingVariantId = firstAvailableVariantId;

      // Use parent's fetch method
      // If it's a different product, we need to morph the entire product card
      this.fetchUpdatedSection(requestUrl, isDifferentProduct);
      return;
    }

    // For combined listings with different products, update the product card image
    if (isDifferentProduct && this.parentProductCard instanceof ProductCard) {
      // Get the media ID from the swatch label (set by variant-combined-listing-picker)
      const swatchLabel = clickedSwatch.closest('label');
      const mediaId = swatchLabel?.dataset.mediaId || clickedSwatch.dataset.optionMediaId;

      // If we have a media ID, try to update the slideshow immediately
      if (mediaId && this.parentProductCard.refs.slideshow) {
        const slideshow = this.parentProductCard.refs.slideshow;
        const mediaIdStr = mediaId.toString();

        // Try to find the slide with this media ID
        const slide = Array.from(slideshow.slides || []).find((s) => s.getAttribute('slide-id') === mediaIdStr);

        if (slide) {
          // Slide exists - select it immediately for instant feedback
          slideshow.select({ id: mediaIdStr }, undefined, { animate: false });
        }
      }

      // Fetch the updated section to update other product card data
      // The #updateProductCardImages method will handle updating the slideshow if the slide doesn't exist
      const selectedOption = event.target instanceof HTMLInputElement ? event.target : event.target;
      const requestUrl = this.buildRequestUrl(selectedOption);
      this.fetchUpdatedSection(requestUrl, false);
      return;
    }

    // For all other cases, use the default behavior
    super.variantChanged(event);
  }

  /**
   * Shows all swatches.
   * @param {Event} [event] - The event that triggered the show all swatches.
   */
  showAllSwatches(event) {
    event?.preventDefault();

    const { overflowList } = this.refs;

    if (overflowList instanceof OverflowList) {
      overflowList.showAll();
    }
  }
}

if (!customElements.get('swatches-variant-picker-component')) {
  customElements.define('swatches-variant-picker-component', SwatchesVariantPickerComponent);
}
