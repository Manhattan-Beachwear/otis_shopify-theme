import { OverflowList } from '@theme/critical';
import VariantPicker from '@theme/variant-picker';
import { Component } from '@theme/component';
import { debounce, isDesktopBreakpoint, mediaQueryLarge, requestYieldCallback } from '@theme/utilities';
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent, SlideshowSelectEvent } from '@theme/events';
import { morph } from '@theme/morph';
import './combined-listing-group.js';

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

    // Initialize selected swatch from checked input (for combined listings)
    this.#initializeSelectedSwatch();

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

    // Store selected swatch image URL for legacy swatches (non-combined listings)
    // This ensures the image persists after clicking a swatch
    const checkedInput = this.querySelector('input[type="radio"]:checked[data-featured-image-url]');
    if (checkedInput instanceof HTMLInputElement && checkedInput.dataset.featuredImageUrl) {
      // This is a legacy swatch that was clicked - store the image URL and update the image immediately
      const featuredImageUrl = checkedInput.dataset.featuredImageUrl;
      this.#selectedSwatchImageUrl = featuredImageUrl;

      // Update the image immediately when swatch is clicked
      const { slideshow } = this.refs;
      if (slideshow && slideshow.slides && slideshow.slides.length > 0) {
        const currentSlide = slideshow.slides[slideshow.current || 0];
        if (currentSlide) {
          const img = currentSlide.querySelector('img');
          if (img instanceof HTMLImageElement) {
            img.src = featuredImageUrl;
            img.srcset = featuredImageUrl;
            // Also update any picture source elements
            const picture = currentSlide.querySelector('picture');
            if (picture) {
              const sources = picture.querySelectorAll('source');
              sources.forEach((source) => {
                if (source instanceof HTMLSourceElement && source.srcset) {
                  source.srcset = featuredImageUrl;
                }
              });
            }
          }
        }
      }
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
  /** @type {string | null} */
  #originalProductUrl = null;
  /** @type {string | null} */
  #originalImageSrc = null;
  /** @type {string | null} */
  #selectedSwatchImageUrl = null;
  /** @type {string | null} */
  #selectedSwatchProductUrl = null;

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

    // Convert media ID to string for comparison
    const idStr = id.toString();

    // Quick check: if no event, this is definitely a legacy swatch (original behavior)
    // Also check early if this might be a combined listing swatch
    if (!event) {
      // Original simple behavior for legacy swatches (no event parameter)
      slideshow.select({ id: idStr }, undefined, { animate: false });
      return;
    }

    // Check if this is a combined listing swatch (different product)
    // Get product data directly from the swatch element
    let connectedProductUrl = null;
    let featuredImageUrl = null;
    /** @type {HTMLElement | null} */
    let swatchElement = null;

    const target = event.target instanceof Element ? event.target : null;

    // Find the label or input element that has the product data
    if (target) {
      if (target instanceof HTMLLabelElement && target.dataset.productUrl) {
        swatchElement = target;
      } else if (target instanceof HTMLInputElement && target.dataset.productUrl) {
        swatchElement = target;
      } else {
        // Try to find the label or input from the target
        const label = target.closest('label[data-product-url]');
        if (label instanceof HTMLLabelElement) {
          swatchElement = label;
        } else {
          const input =
            target.closest('input[data-product-url]') ||
            target.closest('label')?.querySelector('input[data-product-url]');
          if (input instanceof HTMLInputElement) {
            swatchElement = input;
          }
        }
      }
    }

    // Fallback: search for input with matching media ID (only if we haven't found one yet)
    if (!swatchElement && idStr) {
      const allInputs = this.querySelectorAll('input[data-option-media-id]');
      for (const inp of allInputs) {
        if (inp instanceof HTMLInputElement && inp.dataset.optionMediaId === idStr) {
          swatchElement = inp;
          break;
        }
      }
    }

    // Quick check: if no swatchElement found or no combined listing indicators, use legacy behavior
    if (!swatchElement || (!swatchElement.dataset.productId && !swatchElement.dataset.productUrl)) {
      // Legacy swatch - use featured image URL to update current slide (like combined listings)
      // Get the featured image URL from the swatch element
      let featuredImageUrl = null;

      // Try to get from label first, then input
      if (event?.target) {
        const target = event.target instanceof Element ? event.target : null;
        if (target) {
          const label = target.closest('label[data-featured-image-url]');
          if (label instanceof HTMLLabelElement && label.dataset.featuredImageUrl) {
            featuredImageUrl = label.dataset.featuredImageUrl;
          } else {
            const input =
              target.closest('input[data-featured-image-url]') ||
              target.closest('label')?.querySelector('input[data-featured-image-url]');
            if (input instanceof HTMLInputElement && input.dataset.featuredImageUrl) {
              featuredImageUrl = input.dataset.featuredImageUrl;
            }
          }
        }
      }

      // If we have a featured image URL, update the current slide's image directly
      if (featuredImageUrl && slideshow.slides && slideshow.slides.length > 0) {
        const currentSlide = slideshow.slides[slideshow.current || 0];
        if (currentSlide) {
          const img = currentSlide.querySelector('img');
          if (img instanceof HTMLImageElement) {
            // Store original image source only if there's no selected swatch
            // (we want to preserve the selected swatch image, not the original)
            if (!this.#originalImageSrc && !this.#selectedSwatchImageUrl) {
              this.#originalImageSrc = img.src || '';
            }

            // Update the image source
            img.src = featuredImageUrl;
            img.srcset = featuredImageUrl;
            // Also update any picture source elements
            const picture = currentSlide.querySelector('picture');
            if (picture) {
              const sources = picture.querySelectorAll('source');
              sources.forEach((source) => {
                if (source instanceof HTMLSourceElement && source.srcset) {
                  source.srcset = featuredImageUrl;
                }
              });
            }

            // If this swatch is checked (clicked), store it as the selected swatch
            // so the image persists until another swatch is selected
            const checkedInput =
              event?.target instanceof Element
                ? event.target.closest('label')?.querySelector('input[type="radio"]:checked') ||
                  (event.target instanceof HTMLInputElement && event.target.checked ? event.target : null)
                : null;

            if (checkedInput instanceof HTMLInputElement) {
              // This swatch is selected - store the image URL so it persists
              this.#selectedSwatchImageUrl = featuredImageUrl;
            }
          }
        }
        return;
      }

      // Fallback: try to find and select the slide by ID (original behavior)
      slideshow.select({ id: idStr }, undefined, { animate: false });
      return;
    }

    // Get the connected product URL from the swatch element
    // If swatchElement is a label, try to get variant ID and featured image URL from the input inside it
    let variantId = swatchElement.dataset.variantId;
    if (!variantId && swatchElement instanceof HTMLLabelElement) {
      const input = swatchElement.querySelector('input[data-variant-id]');
      if (input instanceof HTMLInputElement) {
        variantId = input.dataset.variantId;
        // Also check for connectedProductUrl on the input
        if (!swatchElement.dataset.connectedProductUrl && input.dataset.connectedProductUrl) {
          swatchElement.dataset.connectedProductUrl = input.dataset.connectedProductUrl;
        }
        // Get featured image URL from input if not on label
        if (!swatchElement.dataset.featuredImageUrl && input.dataset.featuredImageUrl) {
          swatchElement.dataset.featuredImageUrl = input.dataset.featuredImageUrl;
        }
      }
    }

    // Get featured image URL
    featuredImageUrl = swatchElement.dataset.featuredImageUrl;

    connectedProductUrl =
      swatchElement.dataset.connectedProductUrl ||
      (swatchElement.dataset.productUrl && variantId
        ? `${swatchElement.dataset.productUrl}?variant=${variantId}`
        : swatchElement.dataset.productUrl);

    // Check if this is a combined listing swatch (different product)
    // Legacy swatches don't have data-product-id or data-product-url on the input/label
    // Only combined listing swatches have these attributes
    const isCombinedListingSwatch = Boolean(
      (swatchElement.dataset.productId && swatchElement.dataset.productId !== this.dataset.productId) ||
        (swatchElement.dataset.productUrl &&
          this.dataset.productUrl &&
          swatchElement.dataset.productUrl.split('?')[0] !== this.dataset.productUrl.split('?')[0])
    );

    // For combined listings, always update the image even if a slide exists
    // (the slide might be from a different product)
    if (isCombinedListingSwatch && featuredImageUrl) {
      // This is a combined listing - update image and URL
      // Store original URL if not already stored
      if (!this.#originalProductUrl) {
        this.#originalProductUrl = this.refs.productCardLink.href;
      }

      // Update the product card link URL if we have a connected product URL
      if (connectedProductUrl) {
        this.refs.productCardLink.href = connectedProductUrl;

        // Also update other links if they exist
        const { cardGalleryLink, productTitleLink } = this.refs;
        if (cardGalleryLink instanceof HTMLAnchorElement) {
          cardGalleryLink.href = connectedProductUrl;
        }
        if (productTitleLink instanceof HTMLAnchorElement) {
          productTitleLink.href = connectedProductUrl;
        }
      }

      // Update the current slide's image if we have a featured image URL
      if (slideshow.slides && slideshow.slides.length > 0) {
        const currentSlide = slideshow.slides[slideshow.current || 0];
        if (currentSlide) {
          const img = currentSlide.querySelector('img');
          if (img instanceof HTMLImageElement) {
            // Store original image source if not already stored
            if (!this.#originalImageSrc) {
              this.#originalImageSrc = img.src || '';
            }

            // Update the image source
            img.src = featuredImageUrl;
            img.srcset = featuredImageUrl;
            // Also update any picture source elements
            const picture = currentSlide.querySelector('picture');
            if (picture) {
              const sources = picture.querySelectorAll('source');
              sources.forEach((source) => {
                if (source instanceof HTMLSourceElement && source.srcset) {
                  source.srcset = featuredImageUrl;
                }
              });
            }
          }
        }
      }
    } else {
      // Regular legacy swatch - original simple behavior
      slideshow.select({ id: idStr }, undefined, { animate: false });
    }

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

    // Always show the second image (index 1) when hovering over the product image
    // This ensures consistent behavior regardless of swatch selection
    if (slideshow.slides && slideshow.slides.length > 1) {
      // Store the current index before switching (for restoring)
      if (this.#previousSlideIndex === null) {
        this.#previousSlideIndex = slideshow.current || 0;
      }
      // Show the second image (index 1)
      slideshow.select(1, undefined, { animate: false });
      setTimeout(() => this.#preloadNextPreviewImage());
    } else if (this.#previousSlideIndex != null && this.#previousSlideIndex > 0) {
      // Fallback: use previous slide index if available
      slideshow.select(this.#previousSlideIndex, undefined, { animate: false });
    } else {
      // Last resort: go to next slide
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
      // If we have a previous slide index, restore to that
      if (this.#previousSlideIndex !== null) {
        slideshow.select(this.#previousSlideIndex, undefined, { animate: false });
        this.#previousSlideIndex = null;
      } else {
        slideshow.previous(undefined, { animate: false });
      }
    } else {
      // Reset to selected swatch image (or original)
      this.#resetVariant();
      // Clear the previous slide index after reset
      this.#previousSlideIndex = null;
    }
  }

  /**
   * Resets the image to the variant image.
   */
  #resetVariant = () => {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    // If there's a selected swatch (clicked or checked on load), restore to that instead of original
    if (this.#selectedSwatchImageUrl && slideshow.slides && slideshow.slides.length > 0) {
      // Always restore to the first slide (index 0) before updating the image
      // This ensures the selected swatch image is on the correct slide
      if (slideshow.current !== 0) {
        slideshow.select(0, undefined, { animate: false });
      }

      // Wait for slide to be selected, then update the image
      requestAnimationFrame(() => {
        const currentSlide = slideshow.slides?.[0];
        if (currentSlide) {
          const img = currentSlide.querySelector('img');
          if (img instanceof HTMLImageElement && this.#selectedSwatchImageUrl) {
            const selectedImageUrl = this.#selectedSwatchImageUrl;
            img.src = selectedImageUrl;
            img.srcset = selectedImageUrl;
            // Also update picture source elements
            const picture = currentSlide.querySelector('picture');
            if (picture) {
              const sources = picture.querySelectorAll('source');
              sources.forEach((source) => {
                if (source instanceof HTMLSourceElement && source.srcset) {
                  source.srcset = selectedImageUrl;
                }
              });
            }
          }
        }
      });

      // Restore selected product URL
      if (this.#selectedSwatchProductUrl) {
        this.refs.productCardLink.href = this.#selectedSwatchProductUrl;
        const { cardGalleryLink, productTitleLink } = this.refs;
        if (cardGalleryLink instanceof HTMLAnchorElement) {
          cardGalleryLink.href = this.#selectedSwatchProductUrl;
        }
        if (productTitleLink instanceof HTMLAnchorElement) {
          productTitleLink.href = this.#selectedSwatchProductUrl;
        }
      }
      // Clear hover state (but keep selected state)
      this.#originalImageSrc = null;
      this.#originalProductUrl = null;
      return;
    }

    // Restore original URL if it was changed (combined listing hover, no selection)
    if (this.#originalProductUrl) {
      this.refs.productCardLink.href = this.#originalProductUrl;

      // Also restore other links if they exist
      const { cardGalleryLink, productTitleLink } = this.refs;
      if (cardGalleryLink instanceof HTMLAnchorElement) {
        cardGalleryLink.href = this.#originalProductUrl;
      }
      if (productTitleLink instanceof HTMLAnchorElement) {
        productTitleLink.href = this.#originalProductUrl;
      }

      this.#originalProductUrl = null;
    }

    // Restore original image if it was changed (combined listing hover, no selection)
    if (this.#originalImageSrc && slideshow.slides && slideshow.slides.length > 0) {
      const currentSlide = slideshow.slides[slideshow.current || 0];
      if (currentSlide) {
        const img = currentSlide.querySelector('img');
        if (img instanceof HTMLImageElement) {
          const originalSrc = this.#originalImageSrc;
          img.src = originalSrc;
          img.srcset = originalSrc;
          // Also restore picture source elements
          const picture = currentSlide.querySelector('picture');
          if (picture) {
            const sources = picture.querySelectorAll('source');
            sources.forEach((source) => {
              if (source instanceof HTMLSourceElement && source.srcset) {
                source.srcset = originalSrc;
              }
            });
          }
          this.#originalImageSrc = null;
        }
      }
    }

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
   * Sets the selected swatch for combined listings (persists image on click).
   * @param {string | null} imageUrl - The image URL of the selected swatch.
   * @param {string | null} productUrl - The product URL of the selected swatch.
   */
  setSelectedSwatch(imageUrl, productUrl) {
    this.#selectedSwatchImageUrl = imageUrl;
    this.#selectedSwatchProductUrl = productUrl;
  }

  /**
   * Initializes the selected swatch from the checked input on page load.
   * This ensures the first swatch (alphabetically) is set as the selected swatch.
   */
  #initializeSelectedSwatch() {
    // Find the checked swatch input
    const checkedInput = this.querySelector('input[type="radio"]:checked[data-featured-image-url]');
    if (checkedInput instanceof HTMLInputElement) {
      const featuredImageUrl = checkedInput.dataset.featuredImageUrl;
      const mediaId = checkedInput.dataset.optionMediaId;
      const connectedProductUrl =
        checkedInput.dataset.connectedProductUrl ||
        (checkedInput.dataset.productUrl && checkedInput.dataset.variantId
          ? `${checkedInput.dataset.productUrl}?variant=${checkedInput.dataset.variantId}`
          : checkedInput.dataset.productUrl);

      if (featuredImageUrl || connectedProductUrl) {
        this.setSelectedSwatch(featuredImageUrl || null, connectedProductUrl || null);

        // Update the image immediately if we have a featured image URL
        const slideshow = this.refs.slideshow;
        if (slideshow) {
          // Try to find and select the slide with the matching media ID first
          if (mediaId && slideshow.slides) {
            const mediaIdStr = mediaId.toString();
            const slide = Array.from(slideshow.slides).find((s) => s.getAttribute('slide-id') === mediaIdStr);
            if (slide) {
              // Slide exists - select it
              slideshow.select({ id: mediaIdStr }, undefined, { animate: false });
            } else if (featuredImageUrl && slideshow.slides.length > 0) {
              // Slide doesn't exist (different product) - update current slide's image
              const currentIndex = slideshow.current ?? 0;
              const slides = slideshow.slides;
              if (slides) {
                const currentSlide = slides[currentIndex];
                if (currentSlide) {
                  const img = currentSlide.querySelector('img');
                  if (img instanceof HTMLImageElement) {
                    img.src = featuredImageUrl;
                    img.srcset = featuredImageUrl;
                    // Also update picture source elements
                    const picture = currentSlide.querySelector('picture');
                    if (picture) {
                      const sources = picture.querySelectorAll('source');
                      sources.forEach((source) => {
                        if (source instanceof HTMLSourceElement && source.srcset) {
                          source.srcset = featuredImageUrl;
                        }
                      });
                    }
                  }
                }
              }
            }
          } else if (featuredImageUrl && slideshow.slides && slideshow.slides.length > 0) {
            // No media ID - update current slide's image
            const currentIndex = slideshow.current ?? 0;
            const slides = slideshow.slides;
            if (slides) {
              const currentSlide = slides[currentIndex];
              if (currentSlide) {
                const img = currentSlide.querySelector('img');
                if (img instanceof HTMLImageElement) {
                  img.src = featuredImageUrl;
                  img.srcset = featuredImageUrl;
                  // Also update picture source elements
                  const picture = currentSlide.querySelector('picture');
                  if (picture) {
                    const sources = picture.querySelectorAll('source');
                    sources.forEach((source) => {
                      if (source instanceof HTMLSourceElement && source.srcset) {
                        source.srcset = featuredImageUrl;
                      }
                    });
                  }
                }
              }
            }
          }
        }

        // Update the URL if we have a connected product URL
        if (connectedProductUrl && this.refs.productCardLink) {
          this.refs.productCardLink.href = connectedProductUrl;
          const { cardGalleryLink, productTitleLink } = this.refs;
          if (cardGalleryLink instanceof HTMLAnchorElement) {
            cardGalleryLink.href = connectedProductUrl;
          }
          if (productTitleLink instanceof HTMLAnchorElement) {
            productTitleLink.href = connectedProductUrl;
          }
        }
      }
    }
  }

  /**
   * Updates the badge visibility based on the variant being previewed.
   * @param {PointerEvent} [event] - The pointer event that triggered the preview.
   */
  #updateBadgeVisibility(event) {
    const badgeContainer = this.querySelector('.product-badges');
    if (!(badgeContainer instanceof HTMLElement)) return;

    // Get availability from the label that triggered the event
    let isAvailable = true;
    if (event?.target instanceof Element) {
      // The event target might be the label itself or a child element
      const label =
        event.target.closest('label[data-option-available]') ||
        (event.target.tagName === 'LABEL' && event.target.hasAttribute('data-option-available') ? event.target : null);

      if (label instanceof HTMLElement) {
        const available = label.dataset.optionAvailable;
        isAvailable = available === 'true';
      } else {
        // Fallback: check the input element within the label
        const input = event.target.closest('label')?.querySelector('input[data-option-available]');
        if (input instanceof HTMLElement) {
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
      if (soldOutBadge instanceof HTMLElement) {
        soldOutBadge.style.display = 'flex';
      }

      // Hide other badges if they exist
      const otherBadges = badgeContainer.querySelectorAll(
        '.product-badges__badge:not(.product-badges__badge--sold-out-preview)'
      );
      otherBadges.forEach((badge) => {
        if (badge instanceof HTMLElement) {
          badge.style.display = 'none';
        }
      });
    } else {
      // Hide sold out badge if variant is available
      if (soldOutBadge instanceof HTMLElement) {
        soldOutBadge.style.display = 'none';
      }

      // Hide all badges when hovering over an available swatch
      // This ensures badges from the original product don't show when previewing a different product in combined listings
      const allBadges = badgeContainer.querySelectorAll('.product-badges__badge');
      allBadges.forEach((badge) => {
        if (badge instanceof HTMLElement) {
          badge.style.display = 'none';
        }
      });
    }
  }

  /**
   * Resets the badge visibility to the product's default state.
   */
  #resetBadgeVisibility() {
    const badgeContainer = this.querySelector('.product-badges');
    if (!(badgeContainer instanceof HTMLElement)) return;

    // Hide the preview sold out badge
    const soldOutBadge = badgeContainer.querySelector('.product-badges__badge--sold-out-preview');
    if (soldOutBadge instanceof HTMLElement) {
      soldOutBadge.style.display = 'none';
    }

    // Show other badges (restore original state)
    const otherBadges = badgeContainer.querySelectorAll(
      '.product-badges__badge:not(.product-badges__badge--sold-out-preview)'
    );
    otherBadges.forEach((badge) => {
      if (badge instanceof HTMLElement) {
        badge.style.display = '';
      }
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
    const themeTranslations = /** @type {any} */ (window.Shopify)?.theme?.translations;
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
  /** @type {AbortController | undefined} */
  #combinedListingAbortController;

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
   * Fetches a combined listing product and updates the product card.
   * @param {string} requestUrl - The URL to fetch.
   */
  #fetchCombinedListingProduct(requestUrl) {
    // Abort any pending request
    if (this.#combinedListingAbortController) {
      this.#combinedListingAbortController.abort();
    }
    this.#combinedListingAbortController = new AbortController();

    fetch(requestUrl, { signal: this.#combinedListingAbortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, 'text/html');

        // Find the product card in the response
        const newProductCard = html.querySelector('product-card');
        if (!newProductCard) return;

        // Find the current product card
        const currentProductCard = this.parentProductCard;
        if (!(currentProductCard instanceof ProductCard)) return;

        // Morph the entire product card
        morph(currentProductCard, newProductCard);

        // Dispatch variant update event
        const variantScript = newProductCard.querySelector(
          'swatches-variant-picker-component script[type="application/json"]'
        );
        if (variantScript?.textContent) {
          const variantData = JSON.parse(variantScript.textContent);
          const selectedInput = newProductCard.querySelector('input[type="radio"]:checked[data-variant-id]');
          const selectedOptionId = selectedInput instanceof HTMLInputElement ? selectedInput.dataset.variantId : null;

          if (selectedOptionId && newProductCard instanceof HTMLElement) {
            const htmlDoc = new DOMParser().parseFromString(responseText, 'text/html');
            currentProductCard.dispatchEvent(
              new VariantUpdateEvent(variantData, selectedOptionId, {
                html: htmlDoc,
                productId: newProductCard.dataset.productId || '',
                newProduct: {
                  id: newProductCard.dataset.productId || '',
                  url: newProductCard.dataset.productUrl || '',
                },
              })
            );
          }
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          // Silently handle errors
        }
      });
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
    // Use product data from the swatch element directly
    const swatchProductId = clickedSwatch.dataset.productId;
    const swatchProductUrl = clickedSwatch.dataset.productUrl;
    const connectedProductUrl =
      clickedSwatch.dataset.connectedProductUrl ||
      (swatchProductUrl && clickedSwatch.dataset.variantId
        ? `${swatchProductUrl}?variant=${clickedSwatch.dataset.variantId}`
        : swatchProductUrl);
    const currentProductUrl = this.dataset.productUrl?.split('?')[0];
    const isDifferentProduct = Boolean(
      (swatchProductId && swatchProductId !== this.dataset.productId) ||
        (connectedProductUrl && connectedProductUrl.split('?')[0] !== currentProductUrl)
    );

    // For combined listing swatch inputs, check if we need special handling
    // Only apply this logic for combined listing swatches (which have data-product-id)
    // Regular swatches should fall through to super.variantChanged(event)
    if (isSwatchInput && swatchProductId && availableCount > 0 && firstAvailableVariantId) {
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
      // Prevent default handling to avoid the option value ID error
      event.stopPropagation();

      // Update the selected option visually
      this.updateSelectedOption(clickedSwatch);

      // Get the media ID from the swatch label (set by variant-combined-listing-swatches)
      const swatchLabel = clickedSwatch.closest('label');
      const mediaId = swatchLabel?.dataset.mediaId || clickedSwatch.dataset.optionMediaId;

      // Get the featured image URL from the swatch
      const featuredImageUrl = swatchLabel?.dataset.featuredImageUrl || clickedSwatch.dataset.featuredImageUrl;

      // Store the selected swatch's image and URL (for persistence)
      this.parentProductCard.setSelectedSwatch(featuredImageUrl || null, connectedProductUrl || null);

      // Update the image if we have a featured image URL
      if (featuredImageUrl && this.parentProductCard.refs.slideshow) {
        const slideshow = this.parentProductCard.refs.slideshow;
        const mediaIdStr = mediaId?.toString();

        // Try to find the slide with this media ID first
        let slide = null;
        if (mediaIdStr) {
          slide = Array.from(slideshow.slides || []).find((s) => s.getAttribute('slide-id') === mediaIdStr);
        }

        if (slide && mediaIdStr) {
          // Slide exists - select it
          slideshow.select({ id: mediaIdStr }, undefined, { animate: false });
        } else if (slideshow.slides && slideshow.slides.length > 0) {
          // Update the current slide's image
          const currentSlide = slideshow.slides[slideshow.current || 0];
          if (currentSlide) {
            const img = currentSlide.querySelector('img');
            if (img instanceof HTMLImageElement && featuredImageUrl) {
              img.src = featuredImageUrl;
              img.srcset = featuredImageUrl;
              // Also update any picture source elements
              if (featuredImageUrl) {
                const picture = currentSlide.querySelector('picture');
                if (picture) {
                  const sources = picture.querySelectorAll('source');
                  sources.forEach((source) => {
                    if (source instanceof HTMLSourceElement && source.srcset) {
                      source.srcset = featuredImageUrl;
                    }
                  });
                }
              }
            }
          }
        }
      }

      // Update the URL (but don't navigate)
      if (connectedProductUrl) {
        // Update the product card link URL
        this.parentProductCard.refs.productCardLink.href = connectedProductUrl;
        const { cardGalleryLink, productTitleLink } = this.parentProductCard.refs;
        if (cardGalleryLink instanceof HTMLAnchorElement) {
          cardGalleryLink.href = connectedProductUrl;
        }
        if (productTitleLink instanceof HTMLAnchorElement) {
          productTitleLink.href = connectedProductUrl;
        }
      }
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
