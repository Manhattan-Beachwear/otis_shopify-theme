/**
 * Shared utility functions for variant picker pill animation.
 * Extracted from variant-picker.js logic to be reusable across different picker implementations.
 */

/**
 * Updates the selected option pill animation state.
 * Works with both fieldset-based and container-based variant pickers.
 * @param {HTMLInputElement[]} radios - Array of radio inputs for this fieldset/container.
 * @param {number[]} checkedIndices - Array tracking checked indices (max 2).
 * @param {number} inputIndex - The index of the newly selected input.
 * @param {HTMLElement} container - The container element (fieldset or options container) to set CSS variables on.
 */
export function updateSelectedOptionPillAnimation(radios, checkedIndices, inputIndex, container) {
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
    container.style.setProperty('--pill-width-current', `${radios[newCurrentIndex].parentElement?.offsetWidth || 0}px`);
  }

  if (newPreviousIndex !== undefined && radios[newPreviousIndex]) {
    radios[newPreviousIndex].dataset.previousChecked = 'true';
    radios[newPreviousIndex].dataset.currentChecked = 'false';
    container.style.setProperty(
      '--pill-width-previous',
      `${radios[newPreviousIndex].parentElement?.offsetWidth || 0}px`
    );
  }
}
