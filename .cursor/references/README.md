# Developer References

This directory contains detailed documentation for major features and implementations in the Horizon theme.

## Available Documentation

### Combined Listing Variant Picker

**File**: `combined-listing-variant-picker.md`

Comprehensive documentation for the combined listing variant picker feature that enables products with ERP limitations to display multiple variant options (e.g., color and size) by linking related products.

**Key Topics**:

- Architecture and components
- Dual variant detection and filtering
- Swatch priority logic
- Event handling and URL synchronization
- Known issues and solutions
- Best practices

---

### Size Sorting Utility

**File**: `snippets/util-size-sort.liquid`

Reusable utility snippet for sorting size values in logical ascending order. Handles standard sizes (xs, s, m, l, xl, etc.), numeric sizes with feet/inches, and simple numeric values.

**Key Features**:

- Standard size ordering (xs → s → m → l → xl → xxl → 3x, etc.)
- Numeric size parsing (e.g., "5 ft 6 in", "6 ft 0 in")
- Apostrophe notation support ("5'6", "5'6\"")
- Simple numeric sorting ("10", "12", etc.)
- Customizable delimiters for input/output

**Usage**:

```liquid
{% capture sorted_sizes %}
  {% render 'util-size-sort', sizes_string: unique_sizes %}
{% endcapture %}
{% assign unique_sizes = sorted_sizes | strip %}
```

---

## Adding New Documentation

When creating new documentation:

1. Use descriptive filenames (kebab-case)
2. Include an overview section explaining what the feature does
3. Document the problem it solves
4. Include code examples and patterns
5. Document known issues and their solutions
6. Add a testing checklist
7. Include version history

## Updating Documentation

All documentation files are "living documents" - they should be updated:

- When new patterns or solutions are discovered
- When edge cases are encountered
- When bugs are fixed
- When improvements are made

Do not wait to be asked - proactively maintain documentation as part of completing any task.
