import { Component } from '@theme/component';

/**
 * Handles show/hide logic for combined listing product groups.
 * When a swatch is selected, shows the corresponding product card and hides others.
 */
export class CombinedListingGroup extends Component {
  connectedCallback() {
    super.connectedCallback();

    // Initialize: Show the active product card on page load
    this.#initializeActiveCard();

    // Find all swatch inputs in this group
    const swatchInputs = this.querySelectorAll('input[type="radio"][data-product-id]');

    // Listen for swatch changes
    swatchInputs.forEach((input) => {
      input.addEventListener('change', this.#handleSwatchChange.bind(this));
    });

    // Also listen for clicks on swatch labels
    const swatchLabels = this.querySelectorAll('label[data-product-id]');
    swatchLabels.forEach((label) => {
      label.addEventListener('click', (event) => {
        const input = label.querySelector('input[type="radio"]');
        if (input instanceof HTMLInputElement) {
          // Small delay to ensure input is checked
          setTimeout(() => {
            this.#handleSwatchChange({ target: input });
          }, 0);
        }
      });
    });
  }

  /**
   * Initialize the active card based on data-active-product-id attribute
   */
  #initializeActiveCard() {
    const groupContainer = this.closest('.combined-listing-group');
    if (!(groupContainer instanceof HTMLElement)) return;

    const activeProductId = groupContainer.getAttribute('data-active-product-id');
    if (!activeProductId) return;

    // Find all product cards in this group
    const productCards = this.querySelectorAll('.combined-listing-product-card');

    productCards.forEach((card) => {
      const cardProductId = card.dataset.productId;
      const isActive =
        cardProductId === activeProductId ||
        cardProductId === activeProductId.toString() ||
        cardProductId?.toString() === activeProductId;

      if (isActive) {
        // Show this product card
        card.setAttribute('data-is-active', 'true');
        card.classList.remove('combined-listing-product-card--hidden');
        card.style.display = '';
      } else {
        // Hide other product cards
        card.setAttribute('data-is-active', 'false');
        card.classList.add('combined-listing-product-card--hidden');
        card.style.display = 'none';
      }
    });
  }

  /**
   * Handles swatch selection change - shows the corresponding product card
   * @param {Event} event - The change event
   */
  #handleSwatchChange(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.checked) return;

    const selectedProductId = event.target.dataset.productId;
    if (!selectedProductId) return;

    // Find all product cards in this group
    const productCards = this.querySelectorAll('.combined-listing-product-card');

    productCards.forEach((card) => {
      const cardProductId = card.dataset.productId;
      const isActive =
        cardProductId === selectedProductId ||
        cardProductId === selectedProductId.toString() ||
        cardProductId?.toString() === selectedProductId;

      if (isActive) {
        // Show this product card
        card.setAttribute('data-is-active', 'true');
        card.classList.remove('combined-listing-product-card--hidden');
        card.style.display = '';
      } else {
        // Hide other product cards
        card.setAttribute('data-is-active', 'false');
        card.classList.add('combined-listing-product-card--hidden');
        card.style.display = 'none';
      }
    });

    // Update the group's active product ID
    const groupContainer = this.closest('.combined-listing-group');
    if (groupContainer instanceof HTMLElement) {
      groupContainer.setAttribute('data-active-product-id', selectedProductId);
    }
  }
}

if (!customElements.get('combined-listing-group')) {
  customElements.define('combined-listing-group', CombinedListingGroup);
}

