#!/bin/bash

# Get the latest tag, default to v0.0.0 if no tags exist
LATEST_TAG=$(git tag --sort=-v:refname | head -n 1)
if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v0.0.0"
fi

echo "Current version: $LATEST_TAG"

# Extract X, Y, Z from vX.Y.Z
VERSION_NUMBERS=${LATEST_TAG#v}
IFS='.' read -r major minor patch <<< "$VERSION_NUMBERS"

# Bump the Z (patch) version
NEW_PATCH=$((patch + 1))
NEW_TAG="v$major.$minor.$NEW_PATCH"

echo "Bumping to: $NEW_TAG"

# Create the annotated tag
git tag -a "$NEW_TAG" -m "Bump version to $NEW_TAG"

if [ $? -eq 0 ]; then
    echo "Successfully created tag $NEW_TAG"
    echo "Run 'git push origin $NEW_TAG' to share it."
else
    echo "Failed to create tag."
    exit 1
fi
