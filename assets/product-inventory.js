import { ThemeEvents, VariantUpdateEvent } from '@theme/events';
import { morph } from '@theme/morph';

class ProductInventory extends HTMLElement {
  connectedCallback() {
    const closestSection = this.closest('.shopify-section, dialog');
    closestSection?.addEventListener(ThemeEvents.variantUpdate, this.updateInventory);

    // Initialize inventory display on load
    this.updateInventoryDisplay();
  }

  disconnectedCallback() {
    const closestSection = this.closest('.shopify-section, dialog');
    closestSection?.removeEventListener(ThemeEvents.variantUpdate, this.updateInventory);
  }

  /**
   * Updates the inventory display based on current variant.
   */
  updateInventoryDisplay = () => {
    const productId = this.dataset.productId;
    if (!productId || !window.inventories || !window.inventories[productId]) return;

    // Get current variant ID from the product form or variant picker
    const productForm = this.closest('form[action*="/cart/add"]');
    /** @type {HTMLInputElement | null} */
    const variantInput = productForm ? productForm.querySelector('input[name="id"]') : null;
    const variantId = variantInput?.value;

    if (!variantId || !window.inventories[productId][variantId]) return;

    const variantData = window.inventories[productId][variantId];
    /** @type {HTMLElement | null} */
    const inventoryElement = this.querySelector('[data-product-inventory]');
    const threshold = parseInt(inventoryElement?.dataset?.threshold || '10');
    const transfersEnabled = inventoryElement?.dataset?.enabled === 'true';

    // Update regular inventory status
    const inventoryStatus = this.querySelector('.product-inventory__status:not([data-incoming-inventory])');
    const incomingStatus = this.querySelector('[data-incoming-inventory]');

    if (!inventoryStatus || !incomingStatus) return;

    // Determine if we should show low inventory
    const showLowInventory = variantData.quantity > 0 && variantData.quantity <= threshold;

    // Determine if we should show incoming inventory
    // Only show when:
    // - Inventory transfers are enabled (checkbox is true)
    // - Product is out of stock (quantity <= 0 and variant.available == false)
    // - There is inventory in transit (variant.incoming == true)
    // Should NOT show if product is already in stock (quantity > 0)
    const showIncoming =
      transfersEnabled && variantData.quantity <= 0 && !variantData.available && variantData.incoming;

    // Show/hide regular inventory
    // Hide regular inventory if showing incoming inventory message
    if (variantData.quantity > 0 && !showIncoming) {
      inventoryStatus.classList.remove('hide');
    } else {
      inventoryStatus.classList.add('hide');
    }

    // Show/hide incoming inventory
    if (showIncoming) {
      incomingStatus.classList.remove('hide');
      const incomingText = incomingStatus.querySelector('.js-incoming-text');
      if (incomingText && variantData.next_incoming_date) {
        // Format date if needed
        const date = new Date(variantData.next_incoming_date);
        const formattedDate = date.toLocaleDateString();
        incomingText.textContent = `Will be in stock after ${formattedDate}`;
      } else if (incomingText) {
        incomingText.textContent = 'Waiting for stock';
      }
    } else {
      incomingStatus.classList.add('hide');
    }
  };

  /**
   * Updates the inventory.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updateInventory = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.target instanceof HTMLElement && event.target.dataset.productId !== this.dataset.productId) {
      return;
    }

    const newInventory = event.detail.data.html.querySelector('product-inventory');

    if (!newInventory) {
      // If no new inventory in HTML, try to update from stored data
      this.updateInventoryDisplay();
      return;
    }

    morph(this, newInventory, { childrenOnly: true });

    // Update inventory display after morph
    setTimeout(() => {
      this.updateInventoryDisplay();
    }, 0);
  };
}

if (!customElements.get('product-inventory')) {
  customElements.define('product-inventory', ProductInventory);
}
