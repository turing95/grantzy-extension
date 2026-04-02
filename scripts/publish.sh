#!/usr/bin/env bash
set -euo pipefail

REPO="turing95/grantzy-extension"
FLY_APP="grantzy-prod"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# ── Pre-flight checks ──────────────────────────────────────────────

for cmd in gh fly zip node npm; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: '$cmd' is not installed." >&2
        exit 1
    fi
done

if ! gh auth status &>/dev/null; then
    echo "ERROR: gh is not authenticated. Run 'gh auth login'." >&2
    exit 1
fi

# ── Determine version ──────────────────────────────────────────────

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

BUMP="${1:-patch}"

if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    VERSION="$BUMP"
elif [[ "$BUMP" == "patch" || "$BUMP" == "minor" || "$BUMP" == "major" ]]; then
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
    case "$BUMP" in
        major) VERSION="$((MAJOR + 1)).0.0" ;;
        minor) VERSION="$MAJOR.$((MINOR + 1)).0" ;;
        patch) VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
    esac
else
    echo "ERROR: Invalid version argument '$BUMP'. Use a semver (e.g. 2.1.1) or patch|minor|major." >&2
    exit 1
fi

echo "Publishing version: $VERSION"

# ── Bump version in package.json and manifest.json ─────────────────

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
m.version = '$VERSION';
fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n');
"

echo "Bumped version in package.json and manifest.json"

# ── Build ──────────────────────────────────────────────────────────

npm run release
echo "Build complete"

# ── Zip ────────────────────────────────────────────────────────────

ZIP_NAME="grantzy-extension-v${VERSION}.zip"
rm -f "$ZIP_NAME"
(cd release && zip -r "../$ZIP_NAME" .)
echo "Created $ZIP_NAME"

# ── Git commit + tag + push ────────────────────────────────────────

git add package.json manifest.json
git commit -m "Release v${VERSION}"
git tag "v${VERSION}"
git push origin master --tags
echo "Pushed tag v${VERSION}"

# ── GitHub release ─────────────────────────────────────────────────

gh release create "v${VERSION}" "$ZIP_NAME" \
    --title "v${VERSION}" \
    --notes "Extension release v${VERSION}" \
    --repo "$REPO"

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ZIP_NAME}"
echo "GitHub release created: $DOWNLOAD_URL"

# ── Update production RuntimeSetting ───────────────────────────────

DJANGO_CMD="from web_app.models.settings import RuntimeSetting; obj, _ = RuntimeSetting.objects.update_or_create(key='extension_download_url', defaults={'value': '${DOWNLOAD_URL}'}); print(f'Updated to: {obj.value}')"

if fly ssh console -a "$FLY_APP" -C "python /code/manage.py shell -c \"$DJANGO_CMD\"" 2>&1; then
    echo "Production RuntimeSetting updated"
else
    echo ""
    echo "WARNING: Could not update production. Run manually:"
    echo "  fly ssh console -a $FLY_APP -C \"python /code/manage.py shell -c \\\"$DJANGO_CMD\\\"\""
fi

# ── Cleanup ────────────────────────────────────────────────────────

rm -f "$ZIP_NAME"

echo ""
echo "Done! v${VERSION} published."
echo "Download: $DOWNLOAD_URL"
