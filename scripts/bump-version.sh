#!/bin/bash

# Usage: bump-version.sh [patch|minor|major]   (default: patch)
PART="${1:-patch}"
case "$PART" in
    patch|minor|major) ;;
    *)
        echo "Usage: $0 [patch|minor|major]" >&2
        exit 1
        ;;
esac

# Get the latest tag, default to v0.0.0 if no tags exist
LATEST_TAG=$(git tag --sort=-v:refname | head -n 1)
if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v0.0.0"
fi

echo "Current version: $LATEST_TAG"

# Extract X, Y, Z from vX.Y.Z
VERSION_NUMBERS=${LATEST_TAG#v}
IFS='.' read -r major minor patch <<< "$VERSION_NUMBERS"

# Bump the requested part; lower parts reset to 0
case "$PART" in
    major) major=$((major + 1)); minor=0; patch=0 ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    patch) patch=$((patch + 1)) ;;
esac
NEW_TAG="v$major.$minor.$patch"

echo "Bumping to: $NEW_TAG"

# Propose a message (the commits since the last tag) and open it in the editor.
# Lines starting with # are dropped; saving an empty message aborts the tag.
MESSAGE_FILE=$(mktemp)
trap 'rm -f "$MESSAGE_FILE"' EXIT
{
    echo "Release $NEW_TAG"
    echo
    if git rev-parse -q --verify "refs/tags/$LATEST_TAG" >/dev/null; then
        git log --no-merges --format='- %s' "$LATEST_TAG..HEAD"
    else
        git log --no-merges --format='- %s'
    fi
    echo
    echo "# Edit the release notes for $NEW_TAG above. Clear the message to abort."
} > "$MESSAGE_FILE"

# Create the annotated tag
if git tag -a "$NEW_TAG" -e -F "$MESSAGE_FILE"; then
    echo "Successfully created tag $NEW_TAG"
    echo "Run 'git push origin $NEW_TAG' to share it."
else
    echo "Failed to create tag."
    exit 1
fi
