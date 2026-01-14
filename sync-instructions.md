# Sync Parent Updates

## In Each Child Theme:
```bash
# One-time setup
git remote add parent https://github.com/Manhattan-Beachwear/tlc_shopify_theme.git

# When parent updates, run this:
git fetch parent

# Pull ONLY the shared files:
git checkout parent/main -- sections/hero-slideshow.liquid
git checkout parent/main -- sections/header.liquid
git checkout parent/main -- snippets/header-row.liquid
git checkout parent/main -- blocks/_hero-slide.liquid
git checkout parent/main -- assets/slideshow.js
git checkout parent/main -- locales/en.default.schema.json

git commit -m "Sync parent updates [$(date +%Y-%m-%d)]"
git push origin main
```

Note: Replace with current shared files from SHARED_FILES.txt