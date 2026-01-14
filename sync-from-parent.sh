#!/bin/bash
# sync-from-parent.sh
# Syncs whitelisted files from parent theme to a review branch

set -e

PARENT_REMOTE="parent"
PARENT_REPO="https://github.com/Manhattan-Beachwear/tlc_shopify_theme.git"
PARENT_BRANCH="main"
REVIEW_BRANCH="review/parent-sync-$(date +%Y-%m-%d)"

echo "🔄 Syncing from parent theme..."

# Ensure we're on main and clean
if [[ $(git status --porcelain) ]]; then
    echo "❌ Working directory has uncommitted changes. Please commit or stash first."
    exit 1
fi

# Ensure parent remote exists
if ! git remote | grep -q "^${PARENT_REMOTE}$"; then
    echo "Adding parent remote..."
    git remote add $PARENT_REMOTE $PARENT_REPO
fi

# Fetch latest from both parent and origin
echo "Fetching updates..."
git fetch $PARENT_REMOTE
git fetch origin

# Create review branch from current main
echo "Creating review branch: $REVIEW_BRANCH"
git checkout main
git pull origin main
git checkout -b $REVIEW_BRANCH

# Whitelist of files to sync
FILES=(
    "sections/hero-slideshow.liquid"
    "sections/header.liquid"
    "snippets/header-row.liquid"
    "blocks/_hero-slide.liquid"
    "assets/slideshow.js"
    "locales/en.default.schema.json"
)

echo "Syncing ${#FILES[@]} files..."
for file in "${FILES[@]}"; do
    if git cat-file -e $PARENT_REMOTE/$PARENT_BRANCH:"$file" 2>/dev/null; then
        echo "  ✓ $file"
        git checkout $PARENT_REMOTE/$PARENT_BRANCH -- "$file"
    else
        echo "  ⚠ $file (not found in parent, skipping)"
    fi
done

# Check if there are changes
if git diff --quiet; then
    echo "✅ Already up to date!"
    git checkout main
    git branch -D $REVIEW_BRANCH
    exit 0
fi

# Commit and push to review branch
git add -A
git commit -m "Sync parent theme updates [$(date +%Y-%m-%d)]

Synced files:
$(printf '  - %s\n' "${FILES[@]}")

Review changes before merging to main."

git push origin $REVIEW_BRANCH

echo ""
echo "✅ Review branch created: $REVIEW_BRANCH"
echo "📝 Next steps:"
echo "   1. Create PR on GitHub: $REVIEW_BRANCH → main"
echo "   2. Review changes"
echo "   3. Test on Shopify dev theme"
echo "   4. Merge when safe"
echo ""
echo "To return to main: git checkout main"