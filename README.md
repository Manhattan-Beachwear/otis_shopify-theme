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


[Architecture Overview](#architecture-overview) |
[Core Maintenance](#section-a-core-maintenance-updating-the-parent) |
[Store Deployment](#section-b-store-deployment-updating-children) |
[Troubleshooting](#troubleshooting) |
[Developer Tools](#developer-tools) |
[Contributing](#contributing) |
[License](#license)

Horizon is the flagship of a new generation of first party Shopify themes. It incorporates the latest Liquid Storefronts features, including [theme blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks/quick-start?framework=liquid).

- **Web-native in its purest form:** Themes run on the [evergreen web](https://www.w3.org/2001/tag/doc/evergreen-web/). We leverage the latest web browsers to their fullest, while maintaining support for the older ones through progressive enhancement—not polyfills.
- **Lean, fast, and reliable:** Functionality and design defaults to “no” until it meets this requirement. Code ships on quality. Themes must be built with purpose. They shouldn’t support each and every feature in Shopify.
- **Server-rendered:** HTML must be rendered by Shopify servers using Liquid. Business logic and platform primitives such as translations and money formatting don’t belong on the client. Async and on-demand rendering of parts of the page is OK, but we do it sparingly as a progressive enhancement.
- **Functional, not pixel-perfect:** The Web doesn’t require each page to be rendered pixel-perfect by each browser engine. Using semantic markup, progressive enhancement, and clever design, we ensure that themes remain functional regardless of the browser.

## Architecture Overview

The Leisure Collective theme system follows a three-tier deployment architecture:

```
┌──────────────────────────────────────────┐
│   Shopify Horizon (Grandparent)          │
│   Base theme managed by Shopify          │
│   https://github.com/Shopify/horizon.git │
└─────────────────┬────────────────────────┘
                  │
                  │ Updates pulled by Core Maintainers
                  │
┌─────────────────▼───────────────────────┐
│   TLC Core (Parent)                     │
│   tlc_shopify_theme                     │
│   Our customized version of Horizon     │
│   This repository                       │
└─────────────────┬───────────────────────┘
                  │
                  │ Updates pulled by Store Developers
                  │
      ┌───────────┼───────────┐
      │           │           │
┌─────▼─────┐  ┌──▼───┐ ┌─────▼─────┐
│ creatures │  │ otis │ │   sito    │
│ of leisure│  │      │ │           │
│           │  │      │ │           │
└───────────┘  └──────┘ └───────────┘
  (Children)  (Children)  (Children)
```

### Code Flow

**Grandparent → Parent (Core)**
- Shopify releases updates to Horizon
- Core maintainers merge Horizon updates into `tlc_shopify_theme`
- Customizations and shared components are maintained in the Parent

**Parent → Children (Stores)**
- Store developers merge Parent updates into store-specific repos
- Store-specific templates and settings are protected from overwrite
- Each store maintains its own configuration while receiving shared updates

### File Strategy: The "Split Brain" Model

**SYNC (Parent Wins - Automatically Merged):**
- `assets/` - CSS, JavaScript, and images shared across stores
- `sections/*.liquid` - Shared sections and section schemas
- `layout/theme.liquid` - **NEW:** Now synced from Parent (see Protected Hook pattern below)
- `snippets/` - Shared components and partials (except protected hooks)
- `locales/` - Shared translations
- `config/settings_schema.json` - Shared settings schema
- `layout/password.liquid` - Shared password page layout

**PROTECT (Child Wins - Protected via `.gitattributes`):**
- `templates/*.json` - Store-specific page layouts and template configurations
- `config/settings_data.json` - Store-specific theme settings (colors, fonts, etc.)
- `sections/*.json` - Store-specific section configurations
- `snippets/store-custom-head.liquid` - Store-specific head scripts hook
- `snippets/store-custom-body.liquid` - Store-specific body scripts hook

**Critical Rule:** Child stores use `.gitattributes` with `merge=ours` to protect their data and custom scripts while receiving code updates from the Parent.

---

## Section A: Core Maintenance (Updating the Parent)

**Target Audience:** Senior developers managing `tlc_shopify_theme`

**Goal:** Pull updates from Shopify's Horizon into our Core theme while preserving customizations.

### One-Time Setup

Add the Horizon repository as a remote:

```bash
git remote add horizon https://github.com/Shopify/horizon.git
```

Verify the remote was added:

```bash
git remote -v
```

You should see both `origin` (pointing to `tlc_shopify_theme`) and `horizon` (pointing to Shopify's Horizon repository).

### Update Routine

1. **Fetch the latest changes from Horizon:**

```bash
git fetch horizon
```

2. **Check what's changed (optional but recommended):**

```bash
git log horizon/main..HEAD --oneline  # See our commits not in Horizon
git log HEAD..horizon/main --oneline  # See Horizon commits we don't have
```

3. **Merge Horizon's main branch into your local main:**

```bash
git checkout main
git pull origin main  # Ensure you're up to date
git merge horizon/main
```

4. **Resolve merge conflicts manually:**

**Critical Warning:** Do NOT use `.gitattributes` protection here. We want code conflicts so we can manually combine Shopify's updates with our custom work.

**Merge Strategy:**
- **Accept Horizon's changes for:** Structural updates, new features, bug fixes
- **Keep our customizations for:** Custom sections, snippets, and modifications
- **Review carefully:** Changes to files we've customized
- **Manual resolution required:** All conflicts must be reviewed and resolved by hand

Common conflict areas:
- `sections/` - We may have custom sections; keep both when possible
- `snippets/` - Our custom snippets should be preserved (except hook snippets which are empty)
- `assets/` - Merge carefully, preserving our customizations
- `layout/theme.liquid` - Review changes to ensure hook snippets remain intact

5. **Test thoroughly:**

After resolving conflicts, test the theme locally:

```bash
shopify theme dev
```

6. **Commit and push:**

```bash
git add .
git commit -m "Merge Horizon updates from [date or version]"
git push origin main
```

### Best Practices for Core Maintainers

- **Review changes before merging:** Use `git log` and `git diff` to understand what's changing
- **Test in development:** Always test merged changes before pushing to main
- **Document customizations:** Keep `theme-customizations.md` updated when making changes
- **Preserve backwards compatibility:** When adding features, ensure existing store themes continue to work
- **Avoid template changes:** Don't modify `templates/` in the Parent; these belong to Child repos

---

## Section B: Store Deployment (Updating Children)

**Target Audience:** Developers managing specific storefronts (e.g., Otis, Creatures of Leisure)

**Goal:** Push Core features to Stores without breaking their Data or Layouts using Protected Sync.

### One-Time Setup

1. **Add the Parent repository as upstream:**

From inside your Child repo (e.g., `otis`):

```bash
git remote add upstream [Parent_Repo_URL]
```

Example:

```bash
git remote add upstream git@github.com:the-leisure-collective/tlc_shopify_theme.git
```

2. **Configure the merge driver:**

Enable Git's `merge=ours` driver globally (one-time setup per machine):

```bash
git config --global merge.ours.driver true
```

**Important:** This command must be run on each developer's machine. It configures Git to use the `merge=ours` strategy for files specified in `.gitattributes`.

3. **Create `.gitattributes` file:**

Create a `.gitattributes` file in the root of your Child repo with the following content:

```gitattributes
# === CHILD STORE PROTECTION ===

# 1. Protect Store Data
config/settings_data.json       merge=ours
templates/*.json                 merge=ours
sections/*.json                  merge=ours

# 2. Protect Custom Script Hooks
snippets/store-custom-head.liquid   merge=ours
snippets/store-custom-body.liquid   merge=ours

# Note: layout/theme.liquid is SYNCED. Do not add it here.
```

**Critical Notes:**
- `layout/theme.liquid` is **NOT** protected - it syncs from Parent
- Store-specific scripts go in the protected hook snippets (see Protected Hook Pattern below)
- The `.gitattributes` file automatically rejects data changes and accepts code changes during merges

4. **Verify setup:**

```bash
git remote -v
```

You should see:
- `origin` - Your Child repo (e.g., `otis`)
- `upstream` - The Parent repo (`tlc_shopify_theme`)

### Update Routine

1. **Ensure you're on main and up to date:**

```bash
git checkout main
git pull origin main
```

2. **Fetch latest changes from Parent:**

```bash
git fetch upstream
```

3. **Create an update branch (recommended):**

```bash
git checkout -b update-parent-YYYY-MM-DD
```

Replace `YYYY-MM-DD` with today's date (e.g., `update-parent-2025-01-15`).

4. **Merge Parent's main into your update branch:**

```bash
git merge upstream/main
```

**What happens automatically:**
- The `.gitattributes` file will automatically reject changes to protected files (`templates/*.json`, `config/settings_data.json`, `sections/*.json`, hook snippets)
- Code files (`assets/`, `sections/*.liquid`, `layout/theme.liquid`, most `snippets/`) will be updated from Parent
- Your store data and custom scripts remain untouched

5. **Handle any conflicts:**

Most conflicts are automatically resolved by `.gitattributes`. For any remaining conflicts:

- **Core files (assets/, snippets/, sections/*.liquid, layout/theme.liquid):** Generally accept Parent's version
- **Protected files:** Should not conflict (`.gitattributes` handles them), but if they do, keep your version
- **Uncertain conflicts:** Review carefully and test

6. **Test locally:**

```bash
shopify theme dev
```

Test key pages and functionality to ensure nothing broke.

7. **Push and create a Pull Request:**

```bash
git push origin update-parent-YYYY-MM-DD
```

Create a PR in your Child repo, review the changes, then merge to `main`.

8. **Deploy to Shopify:**

After merging to `main`, Shopify's GitHub integration will automatically sync the updated theme to your store.

### Best Practices for Store Developers

- **Always use update branches:** Never merge directly to `main`; use a branch and PR for review
- **Test before merging:** Use `shopify theme dev` to test locally before creating PRs
- **Review changes:** Understand what's being updated from the Parent
- **Keep `.gitattributes` in place:** Never remove or modify the `.gitattributes` file
- **Use hook snippets for scripts:** Never hardcode store-specific scripts in `layout/theme.liquid`; use the protected hook snippets instead
- **Document store-specific changes:** If you make customizations, document them in your store repo

---

## The "Protected Hook" Pattern

**Problem:** `layout/theme.liquid` is now synced from the Parent, but stores need to add store-specific scripts (Google Analytics, Meta Pixel, Gorgias Chat, etc.) without losing them during updates.

**Solution:** The Parent provides empty "dummy" hook snippets that Child stores fill with their scripts and protect via `.gitattributes`.

### How It Works

**In Parent (This Repository):**
- `layout/theme.liquid` includes two hook snippets:
  - `{% render 'store-custom-head' %}` - Renders inside `<head>` tag
  - `{% render 'store-custom-body' %}` - Renders before closing `</body>` tag
- These hook snippets exist as empty files in `snippets/` with documentation comments

**In Child (Store Repositories):**
- Developers fill `snippets/store-custom-head.liquid` with their tracking scripts (GA4, Meta Pixel, etc.)
- Developers fill `snippets/store-custom-body.liquid` with their body scripts (chat widgets, etc.)
- These files are protected in `.gitattributes` with `merge=ours`
- When Parent updates `layout/theme.liquid`, the hook calls remain intact
- When Parent updates the hook snippet files, Child's protected versions are preserved

### Implementation Example

**Parent's `layout/theme.liquid` (synced):**
```liquid
<head>
  <!-- ... standard head content ... -->
  {{ content_for_header }}
  {%- render 'store-custom-head' -%}
</head>
<body>
  <!-- ... body content ... -->
  {%- render 'store-custom-body' -%}
</body>
```

**Child's `snippets/store-custom-head.liquid` (protected):**
```liquid
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>

<!-- Meta Pixel -->
<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'YOUR_PIXEL_ID');
  fbq('track', 'PageView');
</script>
```

**Child's `snippets/store-custom-body.liquid` (protected):**
```liquid
<!-- Gorgias Chat Widget -->
<script>
  (function(w,d,s,o,f,js,fjs){
    w['Gorgias']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s),fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  }(window,document,'script','gorgias','https://config.gorgias.chat/gorgias-chat-bundle-loader.js'));
  Gorgias('set', 'appId', 'YOUR_GORGIAS_APP_ID');
</script>
```

### Developer Rules

**Rule 1:** Never hardcode store-specific scripts directly into `layout/theme.liquid`. It will be overwritten on the next Parent update.

**Rule 2:** Always place store-specific third-party scripts into the appropriate hook snippet:
- Head scripts → `snippets/store-custom-head.liquid`
- Body scripts → `snippets/store-custom-body.liquid`

**Rule 3:** Ensure these snippet files are listed in your Child store's `.gitattributes` as `merge=ours` (see Setup Instructions above).

**Rule 4:** If you need to add a new hook location, coordinate with Core maintainers to add it to the Parent's `layout/theme.liquid` first.

### Benefits

- ✅ Parent can update `layout/theme.liquid` without breaking store scripts
- ✅ Store scripts are protected from accidental overwrites
- ✅ Clear separation between shared code and store-specific code
- ✅ Easy to identify where store scripts should be placed
- ✅ No merge conflicts for store-specific scripts

---

## Troubleshooting

### Why didn't my new section appear after updating?

**Problem:** You pulled updates from the Parent, but a new section isn't showing up in your store.

**Possible Causes:**
1. The section exists in `sections/` but isn't added to any templates
2. The section requires new settings in `config/settings_data.json`
3. The section has dependencies (snippets/assets) that weren't included

**Solution:**
- Check if the section file exists: `ls sections/your-section-name.liquid`
- Review the section's schema to see if it needs settings configured
- Check if the section requires specific snippets or assets
- Manually add the section to a template if needed

### Merge conflicts in files that should be protected

**Problem:** You're getting merge conflicts in protected files even though you have `.gitattributes` set up.

**Possible Causes:**
1. The `merge=ours` driver isn't configured
2. The `.gitattributes` file isn't in the repo root
3. The file paths in `.gitattributes` don't match exactly

**Solution:**
```bash
# Verify merge driver is configured
git config --global merge.ours.driver

# Should output: true

# If not set, configure it:
git config --global merge.ours.driver true

# Verify .gitattributes exists and is correct
cat .gitattributes

# Should include:
# config/settings_data.json       merge=ours
# templates/*.json                merge=ours
# sections/*.json                 merge=ours
# snippets/store-custom-head.liquid   merge=ours
# snippets/store-custom-body.liquid   merge=ours

# If missing, create it with the correct paths
```

**Note:** `layout/theme.liquid` is NOT protected - it syncs from Parent. Use hook snippets for store-specific scripts.

### Parent updates overwrote my store settings

**Problem:** After merging from Parent, your `config/settings_data.json` or hook snippets were reset.

**Possible Causes:**
1. `.gitattributes` file is missing or incorrect
2. `merge=ours` driver isn't configured
3. The file was manually resolved incorrectly during a conflict

**Solution:**
1. Restore from git history:
```bash
# For settings_data.json
git log --oneline config/settings_data.json
git checkout [commit-hash] -- config/settings_data.json

# For hook snippets
git log --oneline snippets/store-custom-head.liquid
git checkout [commit-hash] -- snippets/store-custom-head.liquid
```

2. Fix `.gitattributes` and merge driver (see above)

3. Re-apply your settings/scripts manually if needed

### My store scripts disappeared after updating

**Problem:** After merging from Parent, your tracking scripts (GA4, Meta Pixel, etc.) are gone.

**Possible Causes:**
1. Scripts were hardcoded in `layout/theme.liquid` (which now syncs from Parent)
2. Hook snippets aren't protected in `.gitattributes`
3. Hook snippets were manually resolved incorrectly

**Solution:**
1. **Never hardcode scripts in `layout/theme.liquid`** - it syncs from Parent and will be overwritten
2. Move all store-specific scripts to the protected hook snippets:
   - Head scripts → `snippets/store-custom-head.liquid`
   - Body scripts → `snippets/store-custom-body.liquid`
3. Ensure hook snippets are protected in `.gitattributes`:
```gitattributes
snippets/store-custom-head.liquid   merge=ours
snippets/store-custom-body.liquid   merge=ours
```
4. Restore scripts from git history if needed:
```bash
git log --oneline snippets/store-custom-head.liquid
git checkout [commit-hash] -- snippets/store-custom-head.liquid
```

### Can't fetch from upstream

**Problem:** `git fetch upstream` fails with authentication or URL errors.

**Possible Causes:**
1. Remote URL is incorrect
2. SSH keys aren't set up
3. Repository URL changed

**Solution:**
```bash
# Check current remote URL
git remote get-url upstream

# Update if needed (use SSH for consistency)
git remote set-url upstream git@github.com:the-leisure-collective/tlc_shopify_theme.git

# Test connection
git fetch upstream
```

### Merge conflicts in core files (assets/, snippets/, sections/)

**Problem:** You're getting conflicts in files that should come from the Parent.

**Solution:**
- **Generally accept Parent's version** for core files
- Review the conflict to understand what changed
- If you have store-specific customizations in core files, consider:
  - Moving customizations to store-specific files
  - Documenting why you need to keep your version
  - Discussing with Core maintainers if the customization should be in the Parent

### Theme Check fails after update

**Problem:** Running `shopify theme check` shows errors after updating.

**Possible Causes:**
1. New Theme Check rules in updated Parent
2. Deprecated Liquid syntax
3. Missing required files

**Solution:**
```bash
# Run theme check to see specific errors
shopify theme check

# Fix errors one by one
# Common fixes:
# - Update deprecated Liquid syntax
# - Add missing required attributes
# - Fix schema issues in sections
```

---

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

This repository is the Parent (Core) Theme: `leisure-collective_horizon`.

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

Horizon runs [Theme Check](#theme-check) on every commit via [Shopify/theme-check-action](https://github.com/Shopify/theme-check-action).

## Contributing

We are not accepting contributions to Horizon at this time.

## License

Copyright (c) 2025-present Shopify Inc. See [LICENSE](/LICENSE.md) for further details.
