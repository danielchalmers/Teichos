#!/bin/bash

# Simple verification script for Teichos extension

echo "Teichos Extension Verification"
echo "================================="
echo ""

# Check if dist folder exists
if [ -d "dist" ]; then
    echo "✓ dist folder exists"
else
    echo "✗ dist folder missing"
    exit 1
fi

# Check for required files
required_files=(
    "dist/manifest.json"
    "dist/background/index.js"
    "dist/blocked/index.js"
    "dist/blocked/index.html"
    "dist/options/index.js"
    "dist/options/index.html"
    "dist/popup/index.js"
    "dist/popup/index.html"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ $file exists"
    else
        echo "✗ $file missing"
        exit 1
    fi
done

# Check manifest.json structure
echo ""
echo "Checking manifest.json..."
if grep -q '"manifest_version": 3' dist/manifest.json; then
    echo "✓ Manifest v3 format"
else
    echo "✗ Invalid manifest version"
    exit 1
fi

if grep -q '"storage"' dist/manifest.json; then
    echo "✓ Storage permission present"
else
    echo "✗ Storage permission missing"
    exit 1
fi

if grep -q '"webNavigation"' dist/manifest.json; then
    echo "✓ webNavigation permission present"
else
    echo "✗ webNavigation permission missing"
    exit 1
fi

# Check source files
echo ""
echo "Checking source files..."
required_sources=(
    "src/shared/types/index.ts"
    "src/shared/api/storage.ts"
    "src/background/index.ts"
    "src/options/index.ts"
    "src/blocked/index.ts"
    "src/popup/index.ts"
)

for file in "${required_sources[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ $file exists"
    else
        echo "✗ $file missing"
        exit 1
    fi
done

# Check TypeScript config
if [ -f "tsconfig.json" ]; then
    echo "✓ tsconfig.json exists"
else
    echo "✗ tsconfig.json missing"
    exit 1
fi

# Check build script
if [ -f "scripts/build.ts" ]; then
    echo "✓ scripts/build.ts exists"
else
    echo "✗ scripts/build.ts missing"
    exit 1
fi

echo ""
echo "================================="
echo "All checks passed! ✓"
echo ""
echo "To load the extension:"
echo "1. Open Edge and go to edge://extensions/"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked'"
echo "4. Select the 'dist' folder"
echo ""
