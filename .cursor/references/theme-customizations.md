# Theme Customizations Documentation

## Overview

This document provides comprehensive documentation for all customizations made to the Horizon theme. These customizations were implemented to address specific business requirements, ERP constraints, and UX improvements beyond the base theme functionality.

## Customization Index

| Customization                                                         | Purpose                                                     | Files Created                                                                                                                 | Files Modified                                                                                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Combined Listing Variant Picker](#1-combined-listing-variant-picker) | Enable multi-variant selection for ERP-constrained products | `variant-picker-cl.js`, `variant-picker-utils.js`, `variant-combined-listing-picker.liquid`, `product-title-processed.liquid` | `text.liquid`, `scripts.liquid`                                                                                                                                                         |
| [Custom Accordion Component](#2-custom-accordion-component)           | Enhanced accordion with responsive behavior                 | `accordion-custom.js`                                                                                                         | `blocks/_accordion-row.liquid`, `blocks/accordion.liquid`, `blocks/menu.liquid`, `snippets/cart-note.liquid`, `assets/base.css`                                                         |
| [Custom Disclosure Component](#3-custom-disclosure-component)         | Animated disclosure panels with CSS grid                    | `disclosure-custom.js`                                                                                                        | `snippets/cart-discount.liquid`, `snippets/cart-note.liquid`, `snippets/header-drawer.liquid`, `snippets/sorting.liquid`, `snippets/price-filter.liquid`, `snippets/list-filter.liquid` |
| [Product Custom Property Block](#4-product-custom-property-block)     | Custom product properties with character counting           | `blocks/product-custom-property.liquid`, `assets/product-custom-property.js`                                                  | `scripts.liquid`                                                                                                                                                                        |
| [Product Title Processing](#5-product-title-processing)               | Server-side title processing for combined listings          | `snippets/product-title-processed.liquid`                                                                                     | `snippets/text.liquid`                                                                                                                                                                  |
| [Variant Picker Utilities](#6-variant-picker-utilities)               | Shared utilities for variant picker animations              | `assets/variant-picker-utils.js`                                                                                              | `assets/variant-picker-cl.js`                                                                                                                                                           |
| [Size Sorting Utility](#7-size-sorting-utility)                       | Reusable size sorting for logical ascending order           | `snippets/util-size-sort.liquid`                                                                                              | `snippets/variant-combined-listing-picker.liquid`                                                                                                                                       |

---

## 1. Combined Listing Variant Picker

### Purpose & Strategy

The Combined Listing Variant Picker enables products with ERP limitations (where each product can only have one variant) to display multiple variant options (e.g., color and size) by linking related products together. This allows customers to select both a color and a size, with the system navigating to the appropriate product that matches both selections.

**Strategy**: Instead of modifying the ERP system, we work within Shopify's constraints by:

- Linking related products via metafields
- Aggregating variant options across linked products
- Using morphing for seamless navigation between products
- Maintaining URL state and browser history

### Problem Statement

Due to ERP constraints, each product in Shopify can only have a single variant. However, some products need to display multiple variant dimensions (e.g., "Color" and "Size"). The solution links related products via a metafield (`custom.combined_listing`) and aggregates their variant options to create a unified selection experience.

### Implementation Approach

1. **Dual Variant Detection**: Automatically detects if linked products have both "color" and "size" options
2. **Dynamic Option Filtering**: Color options filter based on available sizes, and size options filter based on selected color
3. **Seamless Navigation**: Uses `morph` for smooth page transitions without full reloads
4. **URL Synchronization**: Maintains URL state with `?variant=` parameter and syncs with browser history
5. **Interchangeable with Legacy Picker**: Works alongside the existing variant picker

### Files Created

- **`snippets/variant-combined-listing-picker.liquid`**: Main Liquid snippet that renders the variant picker UI

  - Detects dual variants (color + size)
  - Builds comprehensive data structure of all variant combinations
  - Renders either single or dual variant picker UI
  - Handles swatch rendering with proper priority

- **`assets/variant-picker-cl.js`**: JavaScript custom elements

  - `<variant-picker-cl>`: Single variant picker (original)
  - `<variant-picker-cl-dual>`: Dual variant picker (new)
  - Handles event listeners for `popstate` and `VariantUpdateEvent`
  - Manages URL synchronization and navigation logic

- **`assets/variant-picker-utils.js`**: Shared utility functions

  - `updateSelectedOptionPillAnimation()`: Shared pill animation logic for variant selection

- **`snippets/product-title-processed.liquid`**: Server-side product title processing
  - Strips color names from product titles in combined listings
  - Prevents "flash" of unstripped title

### Files Modified

- **`snippets/text.liquid`**: Added logic to detect and process product titles using `product-title-processed.liquid`
- **`snippets/scripts.liquid`**: Added script tag to load `variant-picker-cl.js`

### Usage & Integration

The snippet is automatically used when:

1. A product has a `custom.combined_listing` metafield
2. The metafield contains an array of linked products
3. The variant picker block is added to the product information section

**Metafield Setup**:

- Namespace: `custom`
- Key: `combined_listing`
- Type: `list.product_reference`

### Technical Notes

- **Swatch Priority Logic**: Variant swatch > Variant image > Product image
- **Pill Animation**: Uses CSS variables and data attributes for smooth transitions
- **Button Width Distribution**: Equal-width size buttons using CSS grid
- **Sold-Out Styling**: Reduced opacity, special border, and SVG strikethrough

### Related Documentation

See [combined-listing-variant-picker.md](./combined-listing-variant-picker.md) for comprehensive documentation on this feature.

---

## 2. Custom Accordion Component

### Purpose & Strategy

The Custom Accordion Component extends the base HTML `<details>` element with enhanced functionality for responsive behavior, accessibility, and user experience improvements. It provides fine-grained control over accordion behavior on mobile vs desktop, escape key support, and smooth animations.

**Strategy**: Enhance the native `<details>` element rather than replacing it, maintaining semantic HTML while adding progressive enhancements through JavaScript.

### Problem Statement

The base theme's accordion implementation lacked:

- Responsive open/close behavior (different defaults for mobile vs desktop)
- Ability to disable accordion interaction on specific breakpoints
- Escape key support for closing accordions when used as menus
- Smooth animations for content reveal

### Implementation Approach

1. **Custom Element**: `<accordion-custom>` wraps `<details>` elements
2. **Responsive Defaults**: `open-by-default-on-mobile` and `open-by-default-on-desktop` attributes
3. **Breakpoint Controls**: `data-disable-on-mobile` and `data-disable-on-desktop` attributes
4. **Escape Key Support**: `data-close-with-escape` attribute for menu-like behavior
5. **CSS Animations**: Smooth height transitions using CSS grid and `interpolate-size`

### Files Created

- **`assets/accordion-custom.js`**: Custom element class
  - `AccordionCustom` extends `HTMLElement`
  - Handles responsive default state
  - Manages click prevention on disabled breakpoints
  - Implements escape key handling

### Files Modified

- **`blocks/_accordion-row.liquid`**: Wraps accordion in `<accordion-custom>` element
- **`blocks/accordion.liquid`**: Uses `<accordion-custom>` for accordion blocks
- **`blocks/menu.liquid`**: Uses `<accordion-custom>` with escape key support
- **`snippets/cart-note.liquid`**: Uses `<accordion-custom>` for cart note accordion
- **`assets/base.css`**: Added CSS for accordion animations and disabled states
  - Smooth transitions using `interpolate-size` and CSS grid
  - Opacity and height animations
  - Cursor styles for disabled states

### Usage & Integration

**Basic Usage**:

```liquid
<accordion-custom
  open-by-default-on-desktop
  open-by-default-on-mobile
>
  <details class="details">
    <summary>Accordion Title</summary>
    <div class="details-content">
      Accordion content
    </div>
  </details>
</accordion-custom>
```

**With Breakpoint Controls**:

```liquid
<accordion-custom
  data-disable-on-mobile="true"
  data-close-with-escape="true"
>
  <details class="details">
    <!-- content -->
  </details>
</accordion-custom>
```

### Technical Notes

- Uses CSS `interpolate-size: allow-keywords` for smooth height animations
- Content visibility transitions prevent layout shifts
- `@starting-style` ensures animations work on initial render
- Media query listeners update default state when breakpoints change

---

## 3. Custom Disclosure Component

### Purpose & Strategy

The Custom Disclosure Component provides a reusable pattern for animated disclosure panels that work with any element following the details/summary pattern. It uses CSS display grid and the `inert` attribute to create smooth height animations when expanding/collapsing content areas.

**Strategy**: Create a lightweight, reusable component that enhances accessibility and provides consistent animation behavior across different disclosure use cases.

### Problem Statement

The theme needed a consistent way to handle animated disclosure panels that:

- Work with forms and interactive elements (not just inside `<details>`)
- Provide smooth height animations
- Maintain proper accessibility attributes
- Use modern CSS features for performance

### Implementation Approach

1. **Component Pattern**: Uses the `Component` base class with refs pattern
2. **CSS Grid Animation**: Relies on CSS display grid for height auto animation
3. **Inert Attribute**: Uses `inert` to manage focus and interaction state
4. **ARIA Management**: Automatically updates `aria-expanded` and `aria-label` attributes

### Files Created

- **`assets/disclosure-custom.js`**: Custom element class
  - `DisclosureCustom` extends `Component`
  - `toggleDisclosure()` method manages state
  - Updates ARIA attributes and inert state

### Files Modified

- **`snippets/cart-discount.liquid`**: Uses `<disclosure-custom>` for discount code form
- **`snippets/cart-note.liquid`**: Uses `<disclosure-custom>` for cart note (via accordion-custom)
- **`snippets/header-drawer.liquid`**: Uses `<disclosure-custom>` for drawer navigation
- **`snippets/sorting.liquid`**: Uses `<disclosure-custom>` for sort options
- **`snippets/price-filter.liquid`**: Uses `<disclosure-custom>` for price filter
- **`snippets/list-filter.liquid`**: Uses `<disclosure-custom>` for list filters

### Usage & Integration

**Basic Usage**:

```liquid
<disclosure-custom>
  {% render 'disclosure-trigger',
    controls_id: 'my-disclosure',
    is_expanded: false,
    disclosure_name: 'accessibility.my_disclosure',
    label_text: 'content.show_more'
  %}
  <div
    id="my-disclosure"
    ref="disclosureContent"
    inert
  >
    Disclosure content
  </div>
</disclosure-custom>
```

**With Disclosure Trigger Snippet**:

```liquid
{% render 'disclosure-trigger',
  controls_id: 'cart-discount-disclosure',
  is_expanded: discount_codes.size > 0,
  disclosure_name: 'accessibility.discount_menu',
  label_text: 'content.discount'
%}
```

### Technical Notes

- Uses `inert` attribute to prevent interaction when closed
- CSS grid enables smooth height transitions without JavaScript calculations
- ARIA attributes are automatically managed for accessibility
- Works with any trigger/content pattern, not just `<details>`

---

## 4. Product Custom Property Block

### Purpose & Strategy

The Product Custom Property Block allows merchants to add custom input fields to product pages where customers can enter personalized information (e.g., engraving text, custom messages). It includes character counting, validation, and support for multiple input types.

**Strategy**: Create a flexible, reusable block that integrates seamlessly with the product form and provides real-time feedback to users.

### Problem Statement

The base theme lacked a way for merchants to collect custom information from customers during product purchase. This is essential for personalized products, customizations, and special instructions.

### Implementation Approach

1. **Block-Based**: Implemented as a theme block for easy addition to product sections
2. **Multiple Input Types**: Supports text, textarea (auto-selected for >45 chars), and checkbox
3. **Character Counting**: Real-time character count display with customizable templates
4. **Form Integration**: Automatically integrates with product form via `form` attribute
5. **Validation**: Supports required fields with proper ARIA attributes

### Files Created

- **`blocks/product-custom-property.liquid`**: Block template

  - Renders input fields based on type
  - Handles character count display
  - Includes heading and description
  - Supports spacing and styling options

- **`assets/product-custom-property.js`**: Custom element class
  - `ProductCustomProperty` extends `Component`
  - `handleInput()` updates character count
  - Uses template strings for dynamic count display

### Files Modified

- **`snippets/scripts.liquid`**: Added script tag to load `product-custom-property.js`

### Usage & Integration

**Block Settings**:

- `property_heading`: Heading text for the property
- `property_description`: Description/help text
- `property_key`: Key for the custom property (e.g., "engraving", "message")
- `input_type`: "text", "textarea", or "checkbox"
- `max_length`: Maximum characters (25-250, step 5)
- `required`: Whether the field is required
- `placeholder`: Placeholder text for text inputs
- `checkbox_label`: Label for checkbox inputs

**Character Count Template**:
Uses translation key `content.product_custom_property_character_count` with placeholders:

- `[current]`: Current character count
- `[max]`: Maximum character count

### Technical Notes

- Automatically switches to textarea for text inputs with max_length > 45
- Character count updates in real-time as user types
- Uses `maxlength` attribute for browser-level validation
- Custom property values are submitted with the product form as `properties[custom-property-key]`
- Character count positioned absolutely at bottom of input field

---

## 5. Product Title Processing

### Purpose & Strategy

Product Title Processing automatically strips color names from product titles when products are part of a combined listing. This prevents redundant information (e.g., "Product Name: Blue" becomes "Product Name") and improves the user experience.

**Strategy**: Process titles server-side in Liquid to prevent any "flash" of unstripped titles and ensure consistent display across all contexts.

### Problem Statement

In combined listings, product titles often include the color name (e.g., "T-Shirt: Blue", "T-Shirt: Red"). When displaying these products, showing the color in both the title and the variant picker creates redundant, confusing information.

### Implementation Approach

1. **Server-Side Processing**: Title processing happens in Liquid, not JavaScript
2. **Automatic Detection**: Detects if a product is part of a combined listing
3. **Color Extraction**: Extracts color value from current variant
4. **Title Stripping**: Removes color name from title using common separators (`: `, `-`, `|`)
5. **Integration**: Automatically processes titles in text blocks

### Files Created

- **`snippets/product-title-processed.liquid`**: Server-side title processing logic
  - Checks for combined listing metafield
  - Finds color option value from current variant
  - Strips color name from title using multiple separator patterns
  - Returns processed title

### Files Modified

- **`snippets/text.liquid`**: Added logic to detect product titles and process them
  - Checks if text block contains product title
  - Renders processed title using `product-title-processed.liquid`
  - Replaces original title with processed version

### Usage & Integration

**Automatic Processing**:
The title processing happens automatically when:

1. A product has a `custom.combined_listing` metafield, OR
2. A product is referenced in another product's `custom.combined_listing` metafield
3. The product title contains the color name from the current variant

**Manual Usage**:

```liquid
{% render 'product-title-processed', product: product %}
```

### Technical Notes

- Processes titles server-side to prevent "flash" of unstripped title
- Handles multiple separator formats: `: `, `-`, `|`
- Case-insensitive matching for color values
- Normalizes whitespace before comparison
- Falls back to original title if processing fails

---

## 6. Variant Picker Utilities

### Purpose & Strategy

Variant Picker Utilities provides shared functionality for variant picker pill animations. This was extracted from the legacy variant picker to enable code reuse across different picker implementations.

**Strategy**: Extract common functionality into a shared utility module to avoid code duplication and ensure consistent behavior across variant pickers.

### Problem Statement

The pill animation logic for variant selection was duplicated between the legacy variant picker and the combined listing variant picker. This created maintenance burden and potential for inconsistencies.

### Implementation Approach

1. **Utility Function**: Single exported function `updateSelectedOptionPillAnimation()`
2. **Reusable Logic**: Works with both fieldset-based and container-based variant pickers
3. **State Management**: Tracks checked indices (max 2) for smooth transitions
4. **CSS Variable Updates**: Sets CSS variables for pill width calculations

### Files Created

- **`assets/variant-picker-utils.js`**: Shared utility module
  - `updateSelectedOptionPillAnimation()`: Main utility function
  - Manages `data-current-checked` and `data-previous-checked` attributes
  - Updates CSS variables `--pill-width-current` and `--pill-width-previous`

### Files Modified

- **`assets/variant-picker-cl.js`**: Imports and uses `updateSelectedOptionPillAnimation()`

### Usage & Integration

**Import**:

```javascript
import { updateSelectedOptionPillAnimation } from './variant-picker-utils.js';
```

**Usage**:

```javascript
updateSelectedOptionPillAnimation(radios, checkedIndices, inputIndex, container);
```

**Parameters**:

- `radios`: Array of radio input elements
- `checkedIndices`: Array tracking checked indices (max 2)
- `inputIndex`: Index of newly selected input
- `container`: Container element (fieldset or options container) to set CSS variables on

### Technical Notes

- Tracks only the last 2 selections for smooth pill animation
- Uses data attributes for state management
- CSS variables enable smooth width transitions
- Works with any container structure (fieldset or div)

---

## 7. Size Sorting Utility

### Purpose & Strategy

The Size Sorting Utility provides a reusable Liquid snippet for sorting size values in logical ascending order. It handles various size formats including standard sizes (xs, s, m, l, xl, etc.), numeric sizes with feet/inches notation, and simple numeric values.

**Strategy**: Extract size sorting logic into a centralized, reusable utility to ensure consistent size ordering across the theme and reduce code duplication.

### Problem Statement

Size variants in variant pickers were displaying in alphabetical order, which doesn't work for:

- Standard sizes (xs, s, m, l, xl, xxl, 3x, etc.) - should follow size progression
- Numeric sizes with feet/inches (e.g., "5 ft 6 in", "5 ft 10 in", "6 ft 0 in") - should sort numerically
- Simple numeric sizes (e.g., "10", "12", "5.5") - should sort numerically

Alphabetical sorting resulted in illogical ordering like "5 ft 10 in" appearing before "5 ft 6 in".

### Implementation Approach

1. **Standard Size Mapping**: Maps common size names to numeric sort keys (xs=0001, s=0002, m=0003, etc.)
2. **Numeric Parsing**: Extracts numeric values from feet/inches notation and converts to total inches for sorting
3. **Pattern Recognition**: Handles multiple size formats:
   - "X ft Y in" (e.g., "5 ft 6 in")
   - "X'Y" or "X'Y\"" (e.g., "5'6", "5'6\"")
   - Simple numbers (e.g., "10", "12")
4. **Sort Key Generation**: Creates zero-padded sort keys for consistent string sorting
5. **Reusable Snippet**: Can be called from any Liquid file that needs size sorting

### Files Created

- **`snippets/util-size-sort.liquid`**: Reusable size sorting utility
  - Accepts `sizes_string` parameter (delimited by `|||` by default)
  - Supports custom `delimiter` and `output_delimiter` parameters
  - Returns sorted sizes string
  - Handles standard sizes, feet/inches notation, and numeric values

### Files Modified

- **`snippets/variant-combined-listing-picker.liquid`**: Replaced inline sorting logic with utility snippet call
  - Reduced ~185 lines of sorting code to 3 lines
  - Uses `capture` to get sorted result from snippet

### Usage & Integration

**Basic Usage**:

```liquid
{% capture sorted_sizes %}
  {% render 'util-size-sort', sizes_string: unique_sizes %}
{% endcapture %}
{% assign unique_sizes = sorted_sizes | strip %}
```

**With Custom Delimiters**:

```liquid
{% capture sorted_sizes %}
  {% render 'util-size-sort',
     sizes_string: size_list,
     delimiter: ',',
     output_delimiter: ',' %}
{% endcapture %}
```

**Parameters**:

- `sizes_string` (required): Unsorted sizes delimited by `|||` (e.g., "xs|||m|||l|||xl")
- `delimiter` (optional): Input delimiter, defaults to `'|||'`
- `output_delimiter` (optional): Output delimiter, defaults to `'|||'`

### Supported Size Formats

**Standard Sizes**:

- xs, extra small → 0001
- s, small → 0002
- m, medium → 0003
- l, large → 0004
- xl, extra large → 0005
- xxl, 2xl, 2x, double extra large → 0006
- xxxl, 3xl, 3x, triple extra large → 0007
- 4xl, 4x → 0008
- 5xl, 5x → 0009
- 6xl, 6x → 0010

**Numeric Sizes with Feet/Inches**:

- "5 ft 6 in" → 66 total inches → sort key: 000066
- "6 ft 0 in" → 72 total inches → sort key: 000072
- "5'6" or "5'6\"" → 66 total inches → sort key: 000066

**Simple Numeric Sizes**:

- "10" → sort key: 000010
- "12" → sort key: 000012
- "5.5" → sort key: 000005

### Technical Notes

- Uses zero-padded sort keys (6 digits) for consistent string sorting
- Converts feet/inches to total inches for accurate numeric comparison
- Falls back to alphabetical sorting (with prefix) for unrecognized formats
- Case-insensitive matching for standard size names
- Handles edge cases like "6 ft 0 in" (zero inches)

### Integration Points

- **Combined Listing Variant Picker**: Used to sort size options in dual variant mode
- **Future Use**: Can be used in any file that needs size sorting (variant pickers, filters, etc.)

---

## Cross-References

### Related Customizations

1. **Combined Listing Variant Picker** uses:

   - Variant Picker Utilities (pill animation)
   - Product Title Processing (title display)
   - Size Sorting Utility (size option ordering)

2. **Product Title Processing** is used by:

   - Combined Listing Variant Picker (via text.liquid)

3. **Size Sorting Utility** is used by:

   - Combined Listing Variant Picker (size variant ordering)

4. **Custom Accordion** and **Custom Disclosure** are used together in:
   - Cart discount form
   - Cart note
   - Header drawer navigation

### Integration Points

- **Variant Pickers**: Both legacy and combined listing pickers can coexist
- **Product Forms**: Custom properties integrate with product form submission
- **Cart**: Disclosure components used in cart drawer for discount codes and notes
- **Navigation**: Accordion and disclosure components used in header menus

---

## Maintenance Notes

### Updating Customizations

1. **Combined Listing Variant Picker**: See [combined-listing-variant-picker.md](./combined-listing-variant-picker.md) for detailed maintenance notes
2. **Custom Components**: Follow the Component base class pattern for consistency
3. **Liquid Snippets**: Maintain JSDoc-style comments using LiquidDoc format
4. **JavaScript**: Follow theme's JavaScript standards (see `.cursor/rules/javascript-standards.mdc`)

### Testing Considerations

- Test all customizations across mobile and desktop breakpoints
- Verify accessibility with screen readers
- Test form submissions with custom properties
- Verify URL state management in variant pickers
- Test browser back/forward navigation

### Future Improvements

- Support for more than two variant dimensions in combined listings
- Caching of combination data for performance
- Unit tests for JavaScript components
- Enhanced accessibility features
- Documentation for theme developers on extending components

---

## Version History

- **2024-12-XX**: Initial documentation
  - Combined Listing Variant Picker
  - Custom Accordion Component
  - Custom Disclosure Component
  - Product Custom Property Block
  - Product Title Processing
  - Variant Picker Utilities
  - Size Sorting Utility
