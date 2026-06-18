#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/sdk/android"

if command -v gradle >/dev/null 2>&1; then
  cd "$ANDROID_DIR"
  gradle --no-daemon :aerolog:assembleDebug :sample:assembleDebug
  exit 0
fi

if [[ -x "$ANDROID_DIR/gradlew" ]]; then
  cd "$ANDROID_DIR"
  ./gradlew --no-daemon :aerolog:assembleDebug :sample:assembleDebug
  exit 0
fi

cat >&2 <<'EOF'
Gradle is not installed and sdk/android/gradlew is not present.

Install Gradle locally, or run the GitHub Actions workflow
"Android SDK Build" which installs Gradle in CI.
EOF
exit 127
