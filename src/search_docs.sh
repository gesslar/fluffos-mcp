#!/bin/bash
# search_docs.sh - Search FluffOS documentation
# Usage: search_docs.sh <docs_dir> <query>

DOCS_DIR="$1"
QUERY="$2"

if [ -z "$DOCS_DIR" ] || [ -z "$QUERY" ]; then
    echo "Usage: $0 <docs_dir> <query>"
    exit 1
fi

if [ ! -d "$DOCS_DIR" ]; then
    echo "Error: Documentation directory does not exist: $DOCS_DIR"
    exit 1
fi

# Search for the query in markdown files, showing filename and context
# Use ripgrep if available, otherwise fall back to grep
if command -v rg &> /dev/null; then
    rg --type md -i -C 3 --heading --color never "$QUERY" "$DOCS_DIR"
else
    grep -r -i --include="*.md" -H -C 3 "$QUERY" "$DOCS_DIR"
fi
