# The Leisure Collective Theme - Based on Shopify's Horizon theme


### Theme Customizations

**File**: `theme-customizations.md`

Comprehensive documentation for all customizations made to the Horizon theme, including their purpose, strategy, implementation details, and affected files.

**Key Topics**:

- Combined Listing Variant Picker
- Custom Accordion Component
- Custom Disclosure Component
- Product Custom Property Block
- Product Title Processing
- Variant Picker Utilities
- Cross-references and integration points
- Maintenance notes and testing considerations


[Getting started](#getting-started) |
[Staying up to date with Horizon changes](#staying-up-to-date-with-horizon-changes) |
[Developer tools](#developer-tools) |
[Contributing](#contributing) |
[License](#license)

Horizon is the flagship of a new generation of first party Shopify themes. It incorporates the latest Liquid Storefronts features, including [theme blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks/quick-start?framework=liquid).

- **Web-native in its purest form:** Themes run on the [evergreen web](https://www.w3.org/2001/tag/doc/evergreen-web/). We leverage the latest web browsers to their fullest, while maintaining support for the older ones through progressive enhancement—not polyfills.
- **Lean, fast, and reliable:** Functionality and design defaults to “no” until it meets this requirement. Code ships on quality. Themes must be built with purpose. They shouldn’t support each and every feature in Shopify.
- **Server-rendered:** HTML must be rendered by Shopify servers using Liquid. Business logic and platform primitives such as translations and money formatting don’t belong on the client. Async and on-demand rendering of parts of the page is OK, but we do it sparingly as a progressive enhancement.
- **Functional, not pixel-perfect:** The Web doesn’t require each page to be rendered pixel-perfect by each browser engine. Using semantic markup, progressive enhancement, and clever design, we ensure that themes remain functional regardless of the browser.

## Staying up to date with Horizon changes

Say you're building a new theme off Horizon but you still want to be able to pull in the latest changes, you can add a remote `upstream` pointing to this Horizon repository.

1. Navigate to your local theme folder.
2. Verify the list of remotes and validate that you have both an `origin` and `upstream`:

```sh
git remote -v
```

3. If you don't see an `upstream`, you can add one that points to Shopify's Horizon repository:

```sh
git remote add upstream https://github.com/Shopify/horizon-private.git
```

4. Pull in the latest Horizon changes into your repository:

```sh
git fetch upstream
git pull upstream develop
```

## Developer tools

There are a number of really useful tools that the Shopify Themes team uses during development. Horizon is already set up to work with these tools.

### Shopify CLI

[Shopify CLI](https://shopify.dev/docs/storefronts/themes/tools/cli) helps you build Shopify themes faster and is used to automate and enhance your local development workflow. It comes bundled with a suite of commands for developing Shopify themes—everything from working with themes on a Shopify store (e.g. creating, publishing, deleting themes) or launching a development server for local theme development.

You can follow this [quick start guide for theme developers](https://shopify.dev/docs/themes/tools/cli) to get started.

### Theme Check

We recommend using [Theme Check](https://github.com/shopify/theme-check) as a way to validate and lint your Shopify themes.

We've added Theme Check to Horizon's [list of VS Code extensions](/.vscode/extensions.json) so if you're using Visual Studio Code as your code editor of choice, you'll be prompted to install the [Theme Check VS Code](https://marketplace.visualstudio.com/items?itemName=Shopify.theme-check-vscode) extension upon opening VS Code after you've forked and cloned Horizon.

You can also run it from a terminal with the following Shopify CLI command:

```bash
shopify theme check
```

You can follow the [theme check documentation](https://shopify.dev/docs/storefronts/themes/tools/theme-check) for more details.

### Continuous Integration

Horizon uses [GitHub Actions](https://github.com/features/actions) to maintain the quality of the theme. [This is a starting point](https://github.com/Shopify/horizon-private/blob/main/.github/workflows/ci.yml) and what we suggest to use in order to ensure you're building better themes. Feel free to build off of it!

## Parent/Child Theme Distribution, Updates, and Safety

This repository is the Parent (Core) Theme: `tlc_shopify_theme`.

It is used as the shared foundation for multiple Child (Store) Themes, each in its own repo and connected to its own Shopify store via the GitHub integration:

- `creatures-of-leisure`
- `otis`
- `sito`
- `layday`

The intent:
- Core UI + components live in the Parent
- Store-specific templates and settings live in each Child
- Parent updates flow downstream without overwriting store-specific work or breaking live sites

---

## Theme Structure and Ownership

### Parent (Core) owns and distributes
- `assets/` (CSS/JS/images shared across stores)
- `sections/` (shared sections and section schemas)
- `snippets/` (shared components/partials)
- `layout/` (shared layout files)
- `locales/` (shared translations)
- `config/settings_schema.json` (shared settings schema)

### Each Child (Store) owns
- `templates/**` (JSON templates and store layout decisions)
- `config/settings_data.json` (store/theme-instance configuration; treat as environment-specific)

Hard rule: Parent updates must not overwrite Child templates or `config/settings_data.json`.

---

## Distribution Model

- Parent repo: `leisure-collective_horizon` is the source of truth for shared code.
- Each Child repo contains:
  - a copy of the Parent’s shared directories/files
  - store-specific `templates/**` and `config/settings_data.json`
- Updates are applied by merging Parent into each Child (reviewable PR), then Shopify pulls the updated Child repo to the store theme.

---

## Git Remotes (Expected Setup)

In each Child repo, use these remotes:

- `origin` = the Child repo (example: `otis`)
- `upstream` = the Parent repo (`leisure-collective_horizon`)

Example (in a Child repo):

```bash
git remote add upstream git@github.com:the-leisure-collective/leisure-collective_horizon.git
```

Note: Exact repo URLs will vary. Use SSH URLs for consistency.

---

## Update Workflow (Parent → Child)

Recommended approach: update branch + PR per Child repo.

## Spinning Up a New Site (New Child Repo)

The Parent repo (`leisure-collective_horizon`) should remain “core only.” Each site gets its own Child repo that is connected to its own Shopify store via the GitHub integration.

---

## Recommended New Site Flow (Safe + Repeatable)

### 1) Create a new empty GitHub repo for the site
Example names:
- `the-leisure-collective/creatures-of-leisure`
- `the-leisure-collective/otis`
- `the-leisure-collective/sito`
- `the-leisure-collective/layday`

Keep the repo empty (no README/License) if you plan to seed it via push/mirror.

---

### 2) Seed the new Child repo from the baseline Child repo

Choose one of these options:

#### GitHub “Use this template” (clean history)
- Mark the baseline Child repo as a GitHub Template repo
- Click “Use this template” to generate the new site repo
- This creates a fresh repo history, which is often preferred for store-specific work

### One-time setup in each Child repo

Create a `.gitattributes` file in the Child repo to protect store-owned files during merges:

```gitattributes
templates/**                 merge=ours
config/settings_data.json    merge=ours
```

Enable the merge driver (recommended one-time setup per machine):

```bash
git config --global merge.ours.driver true
```

### Pull Parent updates into a Child repo (repeat per Child)

From inside the Child repo:

```bash
git checkout main
git pull origin main
git fetch upstream

git checkout -b update-parent-YYYY-MM-DD
git merge upstream/main
```

Resolve conflicts if any, then push and open a PR:

```bash
git push origin update-parent-YYYY-MM-DD
```

After PR approval, merge into `main`. Shopify GitHub integration will sync the Child repo to the store theme.

---

## Threats and Solutions (How We Avoid Breaking Sites)

### Threat: Parent changes overwrite Child templates
What happens:
- Parent changes to `templates/**` could break store layouts or remove store-specific page structures.

Solutions:
- Child repos use `.gitattributes` with `merge=ours` for `templates/**`
- Parent repo should avoid making template changes entirely

### Threat: Parent changes overwrite `config/settings_data.json`
What happens:
- Store configuration resets or changes unexpectedly.

Solutions:
- Child repos use `.gitattributes` with `merge=ours` for `config/settings_data.json`
- Treat `config/settings_data.json` as store/environment data, not shared code

### Threat: Parent section/snippet schema changes break existing templates
What happens:
- Templates reference block types or setting IDs that were renamed/removed, causing broken sections or missing content.

Solutions (Parent development rules):
- Do not rename/remove existing setting IDs or block types once released
- Prefer additive changes (add new settings, keep defaults safe)
- If behavior must change, gate it behind a new setting with a safe default

### Threat: Removing/renaming shared snippets/sections used by Child templates
What happens:
- Runtime errors, missing UI, or theme compile errors.

Solutions:
- Never delete/rename shared files without a deprecation plan
- If replacing, keep a compatibility shim snippet/section that forwards to the new implementation

### Threat: Parent updates include store-specific templates by accident
What happens:
- Future merges become noisy and risky.

Solutions:
- Parent repo should not accept store templates (or should keep minimal placeholders only)
- Optional: add CI to the Parent repo to fail if `templates/**` or `config/settings_data.json` is modified

---

## Best Practices

- Always bring Parent updates into a Child repo via a dedicated update branch + PR.
- Keep Parent changes backwards-compatible (settings and block types are a contract).
- If a change is risky, roll it out to one Child site first and validate before updating the others.
- Avoid `git push --mirror` for day-to-day updates; prefer pushing only the target branch (usually `main`).


#### Shopify/theme-check-action

Horizon runs [Theme Check](#Theme-Check) on every commit via [Shopify/theme-check-action](https://github.com/Shopify/theme-check-action).

## Contributing

We are not accepting contributions to Horizon at this time.

## License

Copyright (c) 2025-present Shopify Inc. See [LICENSE](/LICENSE.md) for further details.
