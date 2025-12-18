# Combined Listing Variant Picker Implementation

## Overview

The Combined Listing Variant Picker is a custom Shopify theme component that enables products with ERP limitations (where each product can only have one variant) to display multiple variant options (e.g., color and size) by linking related products together. This allows customers to select both a color and a size, with the system navigating to the appropriate product that matches both selections.

## Problem Statement

Due to ERP constraints, each product in Shopify can only have a single variant. However, some products need to display multiple variant dimensions (e.g., "Color" and "Size"). The solution links related products via a metafield (`custom.combined_listing`) and aggregates their variant options to create a unified selection experience.

## Architecture

### Components

1. **Liquid Snippet**: `snippets/variant-combined-listing-picker.liquid`

   - Detects if products have dual variants (color + size)
   - Builds comprehensive data structure of all variant combinations
   - Renders either single or dual variant picker UI
   - Handles swatch rendering with proper priority

2. **JavaScript Custom Elements**:

   - `<variant-picker-cl>`: Single variant picker (original)
   - `<variant-picker-cl-dual>`: Dual variant picker (new)
   - File: `assets/variant-picker-cl.js`

3. **Shared Utilities**: `assets/variant-picker-utils.js`

   - Shared pill animation logic for variant selection

4. **Product Title Processing**: `snippets/product-title-processed.liquid`
   - Server-side logic to strip color names from product titles in combined listings

## Key Features

### 1. Dual Variant Detection

- Automatically detects if linked products have both "color" and "size" options
- Falls back to single variant picker if only one variant type exists

### 2. Dynamic Option Filtering

- Color options filter based on available sizes
- Size options filter based on selected color
- Real-time availability updates

### 3. Seamless Navigation

- Uses `morph` for smooth page transitions without full reloads
- Maintains URL state with `?variant=` parameter
- Syncs with browser history (back/forward buttons)

### 4. Interchangeable with Legacy Picker

- Listens for `VariantUpdateEvent` from `variant-main-picker.liquid`
- Updates state when variants are selected via legacy picker
- Both pickers work together seamlessly

### 5. Visual Polish

- Smooth pill animation on variant selection (matches `variant-main-picker.liquid`)
- Sold-out variant styling with strikethrough SVG
- Equal-width button distribution for size options
- Color swatch prioritization (variant swatch > variant image > product image)

### 6. Product Title Processing

- Server-side stripping of color names from product titles
- Prevents "flash" of unstripped title
- Handles multiple separator formats (`: `, `-`, `|`)

## Files Created/Modified

### Created Files

1. **`snippets/variant-combined-listing-picker.liquid`** (extensively modified)

   - Added dual variant detection logic
   - Added dual variant data structure building
   - Added conditional rendering for single vs dual picker
   - Added CSS for pill animation, sold-out states, button width distribution
   - Added swatch rendering with proper priority

2. **`assets/variant-picker-cl.js`** (extensively modified)

   - Added `VariantPickerCLDual` class
   - Added event listeners for `popstate` and `VariantUpdateEvent`
   - Added URL synchronization logic
   - Added filtering and navigation logic

3. **`assets/variant-picker-utils.js`** (new)

   - Shared `updateSelectedOptionPillAnimation` utility function

4. **`snippets/product-title-processed.liquid`** (new)
   - Server-side product title processing logic

### Modified Files

1. **`snippets/text.liquid`**
   - Added logic to detect and process product titles using `product-title-processed.liquid`

## Technical Implementation Details

### Dual Variant Detection

```liquid
# Iterate through all linked products (including current)
# Check if both "color" and "size" options exist
# Identify option names and positions
```

### Data Structure

The dual variant picker uses a pipe-delimited string format:

```
product_id|variant_id|color_value|size_value|product_url|available|is_current
```

This is passed to JavaScript via `data-combinations` attribute.

### Swatch Priority Logic

1. **Priority 1**: Variant's swatch color or image (`value.swatch.color` or `value.swatch.image`)
2. **Priority 2**: Variant's custom featured media (`value.variant.featured_media`)
3. **Priority 3**: Product's featured media (fallback)

**Important**: When rendering the swatch snippet, only pass `variant_image` if no swatch exists, otherwise the swatch snippet will prioritize the variant image over the swatch color/image.

### Pill Animation

The pill animation uses:

- `data-current-checked` and `data-previous-checked` attributes on radio inputs
- CSS variables `--pill-width-current` and `--pill-width-previous`
- Shared utility function `updateSelectedOptionPillAnimation` from `variant-picker-utils.js`

### Button Width Distribution

For equal-width size buttons:

- Calculate `longest_size_value` in Liquid
- Set `--variant-ch` CSS variable on `<fieldset>`: `{{ longest_size_value }}ch`
- Apply `display: grid` to fieldset and options container
- CSS uses `grid-template-columns: repeat(auto-fit, minmax(var(--variant-ch), 1fr))`

### Sold-Out Styling

- Liquid calculates `size_is_available` for each size option
- Sets `data-option-available="false"` and `aria-disabled="true"` on unavailable options
- CSS applies reduced opacity, special border, and hides pill
- SVG strikethrough rendered directly in Liquid (matching `strikethrough-variant.liquid`)

### URL Synchronization

The dual picker:

1. Reads `?variant=` parameter from URL on initial load
2. Finds matching combination and updates selected color/size
3. Listens for `popstate` events (browser back/forward)
4. Listens for `VariantUpdateEvent` from other pickers
5. Updates URL when navigating to new product

### Event Handling

```javascript
// Listen for variant updates from other pickers
window.addEventListener(ThemeEvents.variantUpdate, this.#boundHandleVariantUpdate);

// Handle URL changes (browser navigation)
window.addEventListener('popstate', this.#boundHandleUrlChange);
```

## Usage

### Basic Usage

The snippet is automatically used when:

1. A product has a `custom.combined_listing` metafield
2. The metafield contains an array of linked products
3. The variant picker block is added to the product information section

### Metafield Setup

1. Create a metafield definition:

   - Namespace: `custom`
   - Key: `combined_listing`
   - Type: `list.product_reference`

2. For each product in the combined listing:
   - Add the metafield
   - Reference all related products (including itself)

### Product Configuration

Each product in the combined listing should:

- Have a single variant (ERP constraint)
- Use consistent option names (e.g., "Color" and "Size")
- Have variants with matching option values across products

## Known Issues and Solutions

### Issue: Liquid Syntax Error with Pipe in Conditionals

**Error**: `Expected end_of_string but found pipe`
**Solution**: Extract filter operations to variables before using in conditionals

```liquid
# Bad
if product_id_check == product_resource.id | append: ''

# Good
assign current_product_id_str = product_resource.id | append: ''
if product_id_check == current_product_id_str
```

### Issue: Filtering Breaks After Morph

**Error**: Options show as available when they shouldn't after navigation
**Solution**: Implement `#reinitializeAfterMorph()` method that re-reads data attributes after DOM updates

### Issue: Swatch Shows Product Image Instead of Variant Color

**Error**: Swatch displays product's featured image instead of variant's custom color
**Solution**: Prioritize swatch color/image, only check variant image if no swatch exists, and don't pass `variant_image` to swatch snippet when swatch exists

### Issue: Parentheses in Liquid Conditionals

**Error**: `Expected dotdot but found comparison`
**Solution**: Liquid doesn't support parentheses for grouping. Use separate `if/elsif` statements:

```liquid
# Bad
if variant_image != blank or (swatch != blank and swatch != '')

# Good
assign should_break = false
if variant_image != blank
  assign should_break = true
elsif swatch != blank and swatch != ''
  assign should_break = true
endif
```

## Best Practices

1. **Always check swatch first**: When looking for variant swatch data, check `value.swatch.color` or `value.swatch.image` before checking `value.variant.featured_media`

2. **Don't modify legacy files**: `variant-picker.js` is a legacy file and should not be modified. Extract shared logic to utility files instead.

3. **Use shared utilities**: Pill animation logic is shared via `variant-picker-utils.js` to avoid duplication.

4. **Server-side processing**: Product title stripping is done server-side to prevent "flash" of unstripped title.

5. **Event-driven updates**: Use `VariantUpdateEvent` for inter-component communication rather than direct DOM manipulation.

6. **Robust string comparison**: Always trim and normalize string values when comparing option values:

```javascript
const normalizedValue = value.trim().toLowerCase();
```

## Future Improvements

1. Support for more than two variant dimensions (currently limited to color + size)
2. Caching of combination data to improve performance
3. Accessibility improvements (ARIA labels, keyboard navigation)
4. Unit tests for JavaScript components
5. Documentation for theme developers on how to extend the component

## Related Files

- `snippets/variant-main-picker.liquid` - Legacy variant picker (reference for styling)
- `snippets/strikethrough-variant.liquid` - Sold-out variant strikethrough SVG
- `snippets/swatch.liquid` - Swatch rendering snippet
- `assets/variant-picker.js` - Legacy variant picker JavaScript (do not modify)
- `assets/events.js` - Custom event definitions (`VariantUpdateEvent`)

## Testing Checklist

- [ ] Dual variant picker displays correctly when both color and size options exist
- [ ] Single variant picker displays correctly when only one variant type exists
- [ ] Color options filter correctly based on selected size
- [ ] Size options filter correctly based on selected color
- [ ] Sold-out variants display with correct styling
- [ ] Pill animation works smoothly on variant selection
- [ ] Navigation to new product works without page reload
- [ ] URL updates correctly with `?variant=` parameter
- [ ] Browser back/forward buttons work correctly
- [ ] Legacy picker updates dual picker when variant is selected
- [ ] Dual picker updates legacy picker when variant is selected
- [ ] Product titles strip color names correctly
- [ ] Swatches display variant colors/images correctly (not product images)
- [ ] Equal-width buttons work for size options
- [ ] Alphabetical sorting works for color and size options

## Version History

- **2024-12-XX**: Initial implementation
  - Dual variant detection and rendering
  - Dynamic option filtering
  - Pill animation matching legacy picker
  - Sold-out variant styling
  - Button width distribution
  - URL synchronization
  - Interchangeable picker functionality
  - Product title stripping (server-side)
  - Swatch priority logic
