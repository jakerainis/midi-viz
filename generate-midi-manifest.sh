#!/usr/bin/env bash
# generate-midi-manifest.sh
# Recursively scans public/midi for .mid/.midi files and generates manifest.json (no trailing comma)

set -e
cd "$(dirname "$0")"

MIDI_DIR="public/midi"
MANIFEST_FILE="$MIDI_DIR/manifest.json"

# Start JSON
{
  echo "{";
  first_folder=true
  find "$MIDI_DIR" -mindepth 1 -type d | sort | while IFS= read -r folder; do
    rel_folder="${folder#$MIDI_DIR/}"
    # Find .mid and .midi files in this folder (portable, no -printf)
    files=()
    while IFS= read -r f; do
      files+=("$f")
    done < <(find "$folder" -maxdepth 1 -type f \( -iname '*.mid' -o -iname '*.midi' \) -exec basename {} \; | sort)
    if [ ${#files[@]} -gt 0 ]; then
      if [ "$first_folder" = false ]; then
        echo ","
      fi
      first_folder=false
      echo -n "  \"$rel_folder\": ["
      for i in "${!files[@]}"; do
        if [ $i -gt 0 ]; then
          echo -n ", "
        fi
        echo -n "\"${files[$i]}\""
      done
      echo -n "]"
    fi
  done
  echo "}"
} > "$MANIFEST_FILE"
echo "Manifest generated at $MANIFEST_FILE"
