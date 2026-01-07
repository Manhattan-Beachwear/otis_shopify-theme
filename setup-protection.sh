#!/bin/bash
echo "Setting up child theme protection..."

# Create post-merge hook
cat > .git/hooks/post-merge << 'HOOK'
#!/bin/bash
echo "🔒 Restoring protected child theme files..."
git checkout HEAD~1 -- config/settings_data.json 2>/dev/null || true
git checkout HEAD~1 -- templates/ 2>/dev/null || true
git checkout HEAD~1 -- sections/ 2>/dev/null || true  
git checkout HEAD~1 -- layout/theme.liquid 2>/dev/null || true
git add .
git commit --amend --no-edit
echo "✅ Protected files restored!"
HOOK

chmod +x .git/hooks/post-merge
git config merge.ours.driver true

echo "✅ Protection configured!"
