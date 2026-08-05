#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# ConvoSketchpad Installer — one-command setup for the ConvoSketchpad web interface
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --dir ~/convosketchpad --version v0.4.0
#   curl -fsSL ... | bash -s -- --dir ~/convosketchpad --branch main
#   curl -fsSL ... | bash -s -- --gateway-url https://gw.example.com --gateway-token <token>
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Cleanup trap ──────────────────────────────────────────────────────
TEMP_FILES=()
RWD_PIDS=()

cleanup() {
  # Kill any lingering run_with_dots background processes
  for pid in "${RWD_PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null || true
  done
  # Remove temp files and directories (stderr captures, build backups)
  for f in "${TEMP_FILES[@]:-}"; do
    [[ -n "$f" ]] && rm -rf "$f" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ── Defaults ──────────────────────────────────────────────────────────
INSTALL_DIR="${CONVOSKETCHPAD_INSTALL_DIR:-${HOME}/convosketchpad}"
BRANCH="main"
BRANCH_EXPLICIT=false
VERSION=""
REPO="https://github.com/MrToyy/convosketchpad.git"
PRODUCT_TAGLINE="A visual branching workspace for agents — revisit any point and continue exploring."
NODE_MIN=22.13.0
SKIP_SETUP=false
DRY_RUN=false
GATEWAY_TOKEN=""
GATEWAY_URL_OVERRIDE=""
ACCESS_MODE=""
SHOW_HELP=false
SEEN_OPTIONS=""
SEEN_OPTION_COUNT=0

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
ORANGE='\033[38;5;208m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

RAIL="${DIM}│${NC}"

ok()   { echo -e "  ${RAIL}  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${RAIL}  ${YELLOW}⚠${NC} $*"; }
fail() { echo -e "  ${RAIL}  ${RED}✗${NC} $*"; }
info() { echo -e "  ${RAIL}  ${CYAN}→${NC} $*"; }
dry()  { echo -e "  ${RAIL}  ${YELLOW}⊘${NC} ${DIM}[dry-run]${NC} $*"; }

# ── Helpers ────────────────────────────────────────────────────────────
# Detect OS family once
IS_MAC=false; IS_DEBIAN=false; IS_FEDORA=false
if [[ "$(uname -s)" == "Darwin" ]]; then IS_MAC=true;
elif command -v apt-get &>/dev/null; then IS_DEBIAN=true;
elif command -v dnf &>/dev/null || command -v yum &>/dev/null; then IS_FEDORA=true; fi

# Display a copy-pasteable command hint
hint() { echo -e "  ${RAIL}"; echo -e "  ${RAIL}  ${BOLD}$1${NC}"; echo -e "  ${RAIL}"; }
cmd()  { echo -e "  ${RAIL}    ${CYAN}\$ $1${NC}"; }

print_deployment_guides() {
  local guides_file="${INSTALL_DIR}/scripts/lib/deployment-guides.json"
  local rendered_guides

  [[ -r "$guides_file" ]] || return 1

  rendered_guides="$(node - "$guides_file" <<'EOF'
const fs = require('node:fs');

const guidesPath = process.argv[2];

try {
  const guides = JSON.parse(fs.readFileSync(guidesPath, 'utf8'));
  if (!Array.isArray(guides)) process.exit(0);

  const rendered = [];
  for (const guide of guides) {
    if (guide && typeof guide.title === 'string' && typeof guide.url === 'string') {
      rendered.push(`     ${guide.title}: ${guide.url}`);
    }
  }

  process.stdout.write(rendered.join('\n'));
} catch {
  process.exit(0);
}
EOF
)" || return 1

  [[ -n "$rendered_guides" ]] || return 1

  echo "     Deployment guides:"
  printf '%s\n' "$rendered_guides"
}

repo_has_local_changes() {
  local repo_dir="$1"
  git -C "$repo_dir" status --porcelain --untracked-files=normal 2>/dev/null | grep -q .
}

# Animated dots while a background process runs
# Usage: run_with_dots "message" command arg1 arg2 ...
# Sets RWD_EXIT to the command's exit code after completion.
run_with_dots() {
  local msg="$1"; shift
  local stderr_file
  stderr_file=$(mktemp /tmp/convosketchpad-rwd-XXXXXX)
  TEMP_FILES+=("$stderr_file")
  printf "  ${RAIL}  ${CYAN}→${NC} %s " "$msg"
  "$@" 2>"$stderr_file" &
  local pid=$!
  RWD_PIDS+=("$pid")
  while kill -0 "$pid" 2>/dev/null; do
    printf "."
    sleep 1
  done
  if wait "$pid"; then
    RWD_EXIT=0
  else
    RWD_EXIT=$?
  fi
  echo ""
  if [[ $RWD_EXIT -ne 0 && -s "$stderr_file" ]]; then
    echo -e "  ${RAIL}  ${RED}stderr:${NC}"
    while IFS= read -r line; do
      echo -e "  ${RAIL}    ${DIM}${line}${NC}"
    done < "$stderr_file"
  fi
  return $RWD_EXIT
}

normalize_version_tag() {
  local raw="$1"
  local normalized="${raw#v}"
  if [[ "$normalized" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "v${normalized}"
    return 0
  fi
  return 1
}

github_repo_path_from_url() {
  local url="$1"
  local path=""

  if [[ "$url" =~ ^https://github.com/([^/]+)/([^/]+)(\.git)?/?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^git@github.com:([^/]+)/([^/]+)(\.git)?/?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^ssh://git@github.com/([^/]+)/([^/]+)(\.git)?/?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    return 1
  fi

  path="${path%.git}"
  echo "$path"
}

fetch_stable_release_tag() {
  local requested_tag="${1:-}"
  local repo_path
  repo_path=$(github_repo_path_from_url "$REPO") || return 1
  [[ "$repo_path" == "MrToyy/convosketchpad" ]] || return 1

  local endpoint="latest"
  if [[ -n "$requested_tag" ]]; then
    endpoint="tags/${requested_tag}"
  fi
  local api_url="https://api.github.com/repos/${repo_path}/releases/${endpoint}"
  local response
  local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

  if [[ -n "$token" ]]; then
    response=$(curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: convosketchpad-installer" \
      -H "Authorization: Bearer ${token}" \
      "$api_url" 2>/dev/null) || return 1
  else
    response=$(curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: convosketchpad-installer" \
      "$api_url" 2>/dev/null) || return 1
  fi

  local tag
  tag=$(printf '%s' "$response" | node -e '
    let data = "";
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try {
        const release = JSON.parse(data);
        const expected = process.argv[1];
        if (
          typeof release.tag_name !== "string"
          || release.draft !== false
          || release.prerelease !== false
          || (expected && release.tag_name !== expected)
        ) {
          process.exit(1);
        }
        process.stdout.write(release.tag_name);
      } catch {
        process.exit(1);
      }
    });
  ' "$requested_tag") || return 1

  normalize_version_tag "$tag" || return 1
}

fetch_latest_release_tag() {
  fetch_stable_release_tag
}

print_help() {
  echo "ConvoSketchpad Installer"
  echo "$PRODUCT_TAGLINE"
  echo ""
  echo "Options:"
  echo "  --dir <path>         Install directory (default: ~/convosketchpad)"
  echo "  --version <vX.Y.Z>   Install a specific release version"
  echo "  --branch <name>      Install from a branch (dev override; bypasses release mode)"
  echo "  --repo <url>         Git repo URL (custom repositories require --branch)"
  echo "  --skip-setup         Keep an existing .env; fail if none exists"
  echo "  --gateway-token <t>  Gateway token (for non-interactive installs)"
  echo "  --gateway-url <url>  Gateway URL (for remote/non-interactive installs)"
  echo "  --access-mode <m>    Non-interactive mode: local|network|tailscale-ip|tailscale-serve"
  echo "  --dry-run            Simulate the install without changing anything"
  echo "  --help               Show this help"
}

mark_option_seen() {
  local option="$1"
  case " ${SEEN_OPTIONS} " in
    *" ${option} "*) fail "Duplicate option: ${option}"; exit 1 ;;
  esac
  SEEN_OPTIONS="${SEEN_OPTIONS} ${option}"
  SEEN_OPTION_COUNT=$((SEEN_OPTION_COUNT + 1))
}

require_option_value() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    fail "${option} requires a value"
    exit 1
  fi
}

STAGE_CURRENT=0
STAGE_TOTAL=5
stage() {
  STAGE_CURRENT=$((STAGE_CURRENT + 1))
  if [[ $STAGE_CURRENT -gt 1 ]]; then
    echo -e "  ${RAIL}"
  fi
  echo -e "  ${ORANGE}●${NC} ${ORANGE}${BOLD}${1}${NC}  ${DIM}[${STAGE_CURRENT}/${STAGE_TOTAL}]${NC}"
  echo -e "  ${RAIL}"
}

stage_done() {
  echo -e "  ${RAIL}"
}

# ── Parse args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)       mark_option_seen --dir; require_option_value --dir "${2:-}"; INSTALL_DIR="$2"; shift 2 ;;
    --branch)    mark_option_seen --branch; require_option_value --branch "${2:-}"; BRANCH="$2"; BRANCH_EXPLICIT=true; shift 2 ;;
    --version)   mark_option_seen --version; require_option_value --version "${2:-}"; VERSION="$2"; shift 2 ;;
    --repo)      mark_option_seen --repo; require_option_value --repo "${2:-}"; REPO="$2"; shift 2 ;;
    --skip-setup) mark_option_seen --skip-setup; SKIP_SETUP=true; shift ;;
    --dry-run)    mark_option_seen --dry-run; DRY_RUN=true; shift ;;
    --gateway-token) mark_option_seen --gateway-token; require_option_value --gateway-token "${2:-}"; GATEWAY_TOKEN="$2"; shift 2 ;;
    --gateway-url) mark_option_seen --gateway-url; require_option_value --gateway-url "${2:-}"; GATEWAY_URL_OVERRIDE="$2"; shift 2 ;;
    --access-mode) mark_option_seen --access-mode; require_option_value --access-mode "${2:-}"; ACCESS_MODE="$2"; shift 2 ;;
    --help|-h)
      mark_option_seen --help; SHOW_HELP=true; shift
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ "$SHOW_HELP" == "true" ]]; then
  if [[ $SEEN_OPTION_COUNT -ne 1 ]]; then
    fail "--help cannot be combined with other options"
    exit 1
  fi
  print_help
  exit 0
fi

if [[ -n "$VERSION" && "$BRANCH_EXPLICIT" == "true" ]]; then
  fail "Use either --version or --branch, not both"
  exit 1
fi

if [[ "$SKIP_SETUP" == "true" && ( -n "$GATEWAY_TOKEN" || -n "$GATEWAY_URL_OVERRIDE" || -n "$ACCESS_MODE" ) ]]; then
  fail "--skip-setup cannot be combined with setup configuration options"
  exit 1
fi

normalize_access_mode() {
  case "$1" in
    "") echo "" ;;
    tailscale) echo "tailscale-ip" ;;
    local|network|tailscale-ip|tailscale-serve) echo "$1" ;;
    *)
      fail "Invalid --access-mode: $1"
      echo "  Supported values: local, network, tailscale-ip, tailscale-serve"
      exit 1
      ;;
  esac
}

normalize_gateway_url() {
  local url="$1"

  if command -v node &>/dev/null; then
    node -e 'const input=process.argv[1];try{const u=new URL(input);if(!["http:","https:"].includes(u.protocol))throw new Error("protocol");if(u.search||u.hash)throw new Error("query-or-fragment");process.stdout.write(u.toString().replace(/\/+$/,""));}catch{process.exit(1)}' "$url" 2>/dev/null || return 1
  else
    [[ "$url" =~ ^https?://[^[:space:]?#]+$ ]] || return 1
    printf '%s' "${url%/}"
  fi
}

ACCESS_MODE=$(normalize_access_mode "$ACCESS_MODE")

if [[ -n "$GATEWAY_URL_OVERRIDE" ]]; then
  normalized_gateway_url=$(normalize_gateway_url "$GATEWAY_URL_OVERRIDE" || true)
  if [[ -z "$normalized_gateway_url" ]]; then
    fail "Invalid --gateway-url: $GATEWAY_URL_OVERRIDE"
    echo "  Expected an absolute http:// or https:// URL without query or fragment"
    exit 1
  fi
  GATEWAY_URL_OVERRIDE="$normalized_gateway_url"
fi

# Pass explicit installer overrides through to the setup wizard. setup remains
# the authority that validates and writes the final Runtime configuration.
if [[ -n "$GATEWAY_TOKEN" ]]; then
  export OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN"
fi
if [[ -n "$GATEWAY_URL_OVERRIDE" ]]; then
  export OPENCLAW_GATEWAY_URL="$GATEWAY_URL_OVERRIDE"
fi

# ── Detect interactive mode ───────────────────────────────────────────
# When piped via curl | bash, stdin is the pipe — but /dev/tty still
# provides access to the controlling terminal for interactive prompts.
# Only treat it as interactive when that controlling terminal is real.
INTERACTIVE=false
if [[ -t 0 ]]; then
  INTERACTIVE=true
elif { tty -s < /dev/tty; } 2>/dev/null; then
  INTERACTIVE=true
fi

# ── Banner ────────────────────────────────────────────────────────────
echo ""
echo -e "  ${ORANGE}${BOLD}◆ ConvoSketchpad${NC}"
echo -e "  ${DIM}  ${PRODUCT_TAGLINE}${NC}"
echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "  ${YELLOW}${BOLD}  ⊘  DRY RUN — nothing will be modified${NC}"
  echo ""
fi
echo -e "  ${DIM}│${NC}"

# ── Check: Node.js ────────────────────────────────────────────────────
node_version_supported() {
  local version="$1"
  local minimum="$2"
  [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]] || return 1
  local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
  [[ "$minimum" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
  local min_major="${BASH_REMATCH[1]}" min_minor="${BASH_REMATCH[2]}" min_patch="${BASH_REMATCH[3]}"
  (( major > min_major )) && return 0
  (( major < min_major )) && return 1
  (( minor > min_minor )) && return 0
  (( minor < min_minor )) && return 1
  (( patch >= min_patch ))
}

check_node() {
  if ! command -v node &>/dev/null; then
    fail "Node.js not found — version ${NODE_MIN}+ is required"
    echo ""
    hint "Install Node.js via nvm (recommended):"
    cmd "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    cmd "source ~/.bashrc"
    cmd "nvm install ${NODE_MIN}"
    echo ""
    if $IS_MAC; then
      echo -e "  ${RAIL}  ${DIM}Or via Homebrew: brew install node@${NODE_MIN%%.*}${NC}"
    elif $IS_DEBIAN; then
      echo -e "  ${RAIL}  ${DIM}Or via apt: https://deb.nodesource.com${NC}"
    fi
    echo ""
    exit 1
  fi

  local node_ver
  node_ver=$(node -v | sed 's/^v//')
  if node_version_supported "$node_ver" "$NODE_MIN"; then
    ok "Node.js v${node_ver} (≥${NODE_MIN} required)"
  else
    fail "Node.js v${node_ver} — version ${NODE_MIN}+ is required"
    echo ""
    # Detect how Node was installed and suggest the right upgrade
    local node_path
    node_path=$(which node 2>/dev/null || echo "")
    if [[ "$node_path" == *".nvm/"* ]]; then
      hint "Upgrade via nvm:"
      cmd "nvm install ${NODE_MIN}"
      cmd "nvm use ${NODE_MIN}"
    elif [[ "$node_path" == *"homebrew"* || "$node_path" == *"Cellar"* ]]; then
      hint "Upgrade via Homebrew:"
      cmd "brew install node@${NODE_MIN%%.*}"
    elif $IS_DEBIAN; then
      hint "Upgrade via nvm (recommended):"
      cmd "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
      cmd "nvm install ${NODE_MIN}"
    else
      hint "Upgrade Node.js:"
      cmd "nvm install ${NODE_MIN}"
    fi
    echo ""
    exit 1
  fi
}

check_npm() {
  if command -v npm &>/dev/null; then
    ok "npm $(npm -v 2>/dev/null)"
  else
    fail "npm not found — it ships with Node.js"
    echo ""
    hint "Reinstall Node.js to get npm:"
    cmd "nvm install ${NODE_MIN}"
    echo ""
    echo -e "  ${RAIL}  ${DIM}If using a system package, npm may be separate: sudo apt install npm${NC}"
    echo ""
    exit 1
  fi
}

check_git() {
  if command -v git &>/dev/null; then
    ok "git $(git --version 2>/dev/null | awk '{print $3}')"
  else
    fail "git not found — required to clone the repo"
    echo ""
    if $IS_MAC; then
      hint "Install git:"
      cmd "xcode-select --install"
      echo -e "  ${RAIL}  ${DIM}Or: brew install git${NC}"
    elif $IS_DEBIAN; then
      hint "Install git:"
      cmd "sudo apt install git"
    elif $IS_FEDORA; then
      hint "Install git:"
      cmd "sudo dnf install git"
    else
      hint "Install git:"
      cmd "sudo apt install git"
      echo -e "  ${RAIL}  ${DIM}Or use your system's package manager${NC}"
    fi
    echo ""
    exit 1
  fi
}

# ── [1/5] Prerequisites ───────────────────────────────────────────────
stage "Prerequisites"

check_node
check_npm
check_git

# ── [2/5] Clone or update ────────────────────────────────────────────
stage "Download"

TARGET_REF=""
TARGET_REF_KIND=""
if [[ -n "$VERSION" ]]; then
  if ! TARGET_REF=$(normalize_version_tag "$VERSION"); then
    fail "Invalid --version: ${VERSION} (expected vX.Y.Z)"
    exit 1
  fi
  if ! TARGET_REF=$(fetch_stable_release_tag "$TARGET_REF"); then
    fail "${TARGET_REF:-$VERSION} is not an official stable ConvoSketchpad Release"
    exit 1
  fi
  TARGET_REF_KIND="version"
elif [[ "$BRANCH_EXPLICIT" == "true" ]]; then
  TARGET_REF="$BRANCH"
  TARGET_REF_KIND="branch"
else
  if ! TARGET_REF=$(fetch_latest_release_tag); then
    fail "Could not resolve the latest stable ConvoSketchpad Release"
    info "Retry later, select an official Release with --version, or use --branch main explicitly for development"
    exit 1
  fi
  TARGET_REF_KIND="release"
fi

info "Using ref ${TARGET_REF} (${TARGET_REF_KIND})"

if [[ -d "$INSTALL_DIR/.git" && "$TARGET_REF_KIND" != "branch" && -f "$INSTALL_DIR/package.json" ]]; then
  installed_version=$(node -e 'const p=require(process.argv[1]); if(typeof p.version!=="string") process.exit(1); process.stdout.write(`v${p.version.replace(/^v/, "")}`)' "$INSTALL_DIR/package.json") || {
    fail "Could not determine the installed ConvoSketchpad version"
    exit 1
  }
  if [[ "$installed_version" != "$TARGET_REF" ]]; then
    fail "The installer cannot upgrade an existing stable Release safely"
    info "Use the transactional updater so code, configuration, and SQLite can roll back together:"
    cmd "cd ${INSTALL_DIR} && npm run update -- --version ${TARGET_REF}"
    exit 1
  fi
fi

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    dry "Would update existing installation in ${INSTALL_DIR}"
    dry "Would refuse a dirty working tree"
    dry "Would checkout ${TARGET_REF}"
  else
    dry "Would clone ${REPO}"
    dry "Would checkout ${TARGET_REF}"
    dry "Would install to ${INSTALL_DIR}"
  fi
else
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    if repo_has_local_changes "$INSTALL_DIR"; then
      fail "Refusing to overwrite a dirty installation"
      info "Commit, stash, or back up ${INSTALL_DIR}, then rerun the installer"
      exit 1
    fi

    cd "$INSTALL_DIR"

    if [[ "$TARGET_REF_KIND" == "branch" ]]; then
      run_with_dots "Fetching ${TARGET_REF}" git fetch origin "$TARGET_REF" -q
      run_with_dots "Checking out ${TARGET_REF}" git checkout --force "$TARGET_REF" -q
      run_with_dots "Resetting to origin/${TARGET_REF}" git reset --hard "origin/${TARGET_REF}" -q
    else
      run_with_dots "Fetching tags" git fetch --tags origin -q
      run_with_dots "Checking out ${TARGET_REF}" git checkout --force "$TARGET_REF" -q
    fi

    ok "Updated to ${TARGET_REF}"
  else
    if [[ "$TARGET_REF_KIND" == "branch" ]]; then
      run_with_dots "Cloning ConvoSketchpad" git clone --branch "$TARGET_REF" --depth 1 -q "$REPO" "$INSTALL_DIR"
    else
      run_with_dots "Cloning ConvoSketchpad" git clone --depth 1 -q "$REPO" "$INSTALL_DIR"
      cd "$INSTALL_DIR"
      run_with_dots "Fetching tags" git fetch --tags origin -q
      run_with_dots "Checking out ${TARGET_REF}" git checkout --force "$TARGET_REF" -q
    fi
    ok "Cloned to ${INSTALL_DIR}"
  fi

  cd "$INSTALL_DIR"
fi

# ── [3/5] Install & Build ────────────────────────────────────────────
stage "Install & Build"

if [[ "$DRY_RUN" == "true" ]]; then
  dry "Would run: npm ci"
  dry "Would run: npm run build"
else
  npm_log=$(mktemp /tmp/convosketchpad-npm-install-XXXXXX)

  run_with_dots "Installing dependencies" bash -c "npm ci --loglevel=error > '$npm_log' 2>&1"
  if [[ $RWD_EXIT -eq 0 ]]; then
    ok "Dependencies installed"

    # Back up existing build outputs for rollback on failure
    BUILD_BACKUP=""
    if [[ -d dist || -d server-dist ]]; then
      BUILD_BACKUP=$(mktemp -d /tmp/convosketchpad-build-backup-XXXXXX)
      TEMP_FILES+=("$BUILD_BACKUP")
      [[ -d dist ]] && cp -a dist "$BUILD_BACKUP/dist"
      [[ -d server-dist ]] && cp -a server-dist "$BUILD_BACKUP/server-dist"
    fi
  else
    fail "npm ci failed"
    echo ""
    # Show the last meaningful lines
    echo -e "  ${RAIL}  ${DIM}── Last 10 lines ──${NC}"
    tail -10 "$npm_log" | while IFS= read -r line; do
      echo -e "  ${RAIL}  ${DIM}${line}${NC}"
    done
    echo -e "  ${RAIL}  ${DIM}── Full log: ${npm_log} ──${NC}"
    echo ""
    # Detect common failure patterns and suggest fixes
    if grep -qi 'EACCES\|permission denied' "$npm_log"; then
      hint "Permissions issue — try installing Node via nvm instead of system packages:"
      cmd "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
      cmd "nvm install ${NODE_MIN}"
      echo -e "  ${RAIL}  ${DIM}nvm installs to your home directory — no sudo needed${NC}"
    elif grep -qi 'node-gyp\|gyp ERR\|make.*Error\|g++.*not found\|cc.*not found' "$npm_log"; then
      hint "Native module compilation failed — install build tools:"
      if $IS_MAC; then
        cmd "xcode-select --install"
      elif $IS_DEBIAN; then
        cmd "sudo apt install build-essential"
      elif $IS_FEDORA; then
        cmd "sudo dnf groupinstall 'Development Tools'"
      else
        cmd "sudo apt install build-essential"
      fi
    elif grep -qi 'ERESOLVE\|peer dep\|could not resolve' "$npm_log"; then
      hint "Dependency conflict — try with a clean slate:"
      cmd "rm -rf node_modules package-lock.json"
      cmd "npm install"
    else
      hint "Troubleshooting:"
      echo -e "  ${RAIL}  ${DIM}1. Check the full log: cat ${npm_log}${NC}"
      echo -e "  ${RAIL}  ${DIM}2. Ensure Node ${NODE_MIN}+ is installed${NC}"
      echo -e "  ${RAIL}  ${DIM}3. Try: rm -rf node_modules && npm install${NC}"
    fi
    echo ""
    exit 1
  fi

  build_log=$(mktemp /tmp/convosketchpad-build-XXXXXX)

  run_with_dots "Building project" bash -c "npm run build > '$build_log' 2>&1"
  if [[ $RWD_EXIT -eq 0 ]]; then
    ok "Client and server built"
  else
    fail "Build failed"
    # Rollback to previous build output if available
    if [[ -n "${BUILD_BACKUP:-}" ]]; then
      rm -rf dist server-dist 2>/dev/null
      [[ -d "$BUILD_BACKUP/dist" ]] && cp -a "$BUILD_BACKUP/dist" dist
      [[ -d "$BUILD_BACKUP/server-dist" ]] && cp -a "$BUILD_BACKUP/server-dist" server-dist
      warn "Restored previous build output"
    fi
    echo ""
    echo -e "  ${RAIL}  ${DIM}── Last 10 lines ──${NC}"
    tail -10 "$build_log" | while IFS= read -r line; do
      echo -e "  ${RAIL}  ${DIM}${line}${NC}"
    done
    echo -e "  ${RAIL}  ${DIM}── Full log: ${build_log} ──${NC}"
    echo ""
    hint "Troubleshooting:"
    echo -e "  ${RAIL}  ${DIM}1. Check the full log: cat ${build_log}${NC}"
    echo -e "  ${RAIL}  ${DIM}2. Try rebuilding: npm run build${NC}"
    echo ""
    exit 1
  fi

  # Clean up temp logs on success
  rm -f "$npm_log" "$build_log" 2>/dev/null

fi

# ── [4/5] Configure ──────────────────────────────────────────────────
stage "Configure"

run_defaults_setup() {
  local setup_args=(--defaults)
  if [[ -n "$ACCESS_MODE" ]]; then
    setup_args+=(--access-mode "$ACCESS_MODE")
  fi
  CONVOSKETCHPAD_INSTALLER=1 npm run setup -- "${setup_args[@]}"
}

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ "$SKIP_SETUP" == "true" ]]; then
    dry "Would keep the existing .env, or fail if it does not exist (--skip-setup)"
  elif [[ "$INTERACTIVE" == "true" && -z "$ACCESS_MODE" && -z "$GATEWAY_TOKEN" && -z "$GATEWAY_URL_OVERRIDE" ]]; then
    dry "Would launch the unified interactive setup wizard"
    dry "Would discover and select Runtimes, configure connections, then select a default Agent"
  else
    setup_description="--defaults"
    [[ -n "$ACCESS_MODE" ]] && setup_description+=" --access-mode ${ACCESS_MODE}"
    dry "Would run the unified non-interactive setup wizard (${setup_description})"
  fi
  if [[ -n "$GATEWAY_URL_OVERRIDE" ]]; then
    dry "Would pass OPENCLAW_GATEWAY_URL to the selected OpenClaw setup Driver"
  fi
  if [[ -n "$GATEWAY_TOKEN" ]]; then
    dry "Would pass OPENCLAW_GATEWAY_TOKEN to the selected OpenClaw setup Driver"
  fi
else
  if [[ "$SKIP_SETUP" == "true" ]]; then
    if [[ -f .env ]]; then
      ok "Skipping setup (--skip-setup flag, .env exists)"
    else
      fail "--skip-setup requires an existing ${INSTALL_DIR}/.env"
      info "Run without --skip-setup so the unified Runtime setup can create it"
      exit 1
    fi
  else
    if [[ -f .env ]]; then
      if [[ -n "$ACCESS_MODE" || -n "$GATEWAY_TOKEN" || -n "$GATEWAY_URL_OVERRIDE" ]]; then
        info "Explicit configuration override supplied — running unified non-interactive setup..."
        run_defaults_setup || {
          fail "Setup failed; the existing .env was not replaced unless setup completed successfully"
          exit 1
        }
      elif [[ "$INTERACTIVE" == "true" ]]; then
        ok "Existing .env found"
        printf "  ${RAIL}  ${YELLOW}?${NC} Run setup wizard anyway? (y/N) "
        if read -r answer < /dev/tty 2>/dev/null; then
          if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" == "y" ]]; then
            echo ""
            CONVOSKETCHPAD_INSTALLER=1 npm run setup < /dev/tty 2>/dev/null || {
              fail "Setup wizard failed"
              exit 1
            }
          else
            ok "Keeping existing configuration"
          fi
        else
          warn "Cannot read input — run ${CYAN}npm run setup${NC} manually to reconfigure"
        fi
      else
        ok "Existing .env found — keeping current configuration"
      fi
    elif [[ "$INTERACTIVE" == "true" && -z "$ACCESS_MODE" && -z "$GATEWAY_TOKEN" && -z "$GATEWAY_URL_OVERRIDE" ]]; then
      CONVOSKETCHPAD_INSTALLER=1 npm run setup < /dev/tty 2>/dev/null || {
        fail "Setup wizard failed; no configuration was generated"
        exit 1
      }
    else
      info "Non-interactive mode — running unified Runtime setup..."
      run_defaults_setup || {
        fail "Non-interactive Runtime setup failed"
        info "Rerun interactively with: cd ${INSTALL_DIR} && npm run setup"
        exit 1
      }
    fi
  fi
fi

# ── [5/5] Systemd service ────────────────────────────────────────────
stage "Service"

setup_systemd() {
  local service_file="/etc/systemd/system/convosketchpad.service"
  local node_bin
  node_bin=$(which node)
  local working_dir="$INSTALL_DIR"

  local node_dir
  node_dir=$(dirname "${node_bin}")

  # Run as the installing user so Runtime configuration and persisted data keep
  # the same ownership as the installation.
  local install_user="${SUDO_USER:-${USER}}"
  local install_group
  install_group=$(id -gn "$install_user" 2>/dev/null || printf '%s' "$install_user")
  local install_home="${HOME}"
  
  # If running via sudo, get the real user's home (no eval — safe from injection)
  if [[ -n "${SUDO_USER:-}" ]]; then
    if command -v getent &>/dev/null; then
      install_home=$(getent passwd "${SUDO_USER}" | cut -d: -f6)
    elif command -v dscl &>/dev/null; then
      install_home=$(dscl . -read "/Users/${SUDO_USER}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
    else
      install_home=$(awk -F: -v user="${SUDO_USER}" '$1 == user {print $6}' /etc/passwd)
    fi
    # Fallback if all lookups returned empty
    if [[ -z "$install_home" ]]; then
      install_home="/home/${SUDO_USER}"
    fi
  fi
  
  local tmp_service
  tmp_service=$(mktemp /tmp/convosketchpad.service.XXXXXX)
  TEMP_FILES+=("$tmp_service")

  cat > "$tmp_service" <<EOF
[Unit]
Description=ConvoSketchpad - ${PRODUCT_TAGLINE}
After=network.target

[Service]
Type=simple
User=${install_user}
Group=${install_group}
WorkingDirectory=${working_dir}
ExecStart=${node_bin} server-dist/index.js
EnvironmentFile=${working_dir}/.env
Environment=NODE_ENV=production
Environment=HOME=${install_home}
Environment=PATH=${node_dir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemd_privileged() {
    if [[ $EUID -eq 0 ]]; then
      "$@"
    elif [[ "$INTERACTIVE" == "true" ]]; then
      sudo "$@" < /dev/tty
    else
      sudo -n "$@"
    fi
  }

  if ! systemd_privileged install -m 0644 "$tmp_service" "$service_file"; then
    fail "Could not install the systemd unit (root permission is required)"
    return 1
  fi
  if ! systemd_privileged systemctl daemon-reload \
    || ! systemd_privileged systemctl enable convosketchpad.service >/dev/null; then
    fail "Could not register the systemd service"
    return 1
  fi

  if [[ -f "${working_dir}/.env" ]]; then
    if ! systemd_privileged systemctl restart convosketchpad.service; then
      fail "Systemd service was installed but could not be restarted"
      return 1
    fi
    ok "Systemd service installed and running"
  else
    ok "Systemd service installed (not started — run ${CYAN}npm run setup${NC} first, then ${CYAN}sudo systemctl start convosketchpad.service${NC})"
  fi
  info "Service runs as: ${install_user}"
}

setup_launchd() {
  local node_bin
  node_bin=$(which node)
  local working_dir="$INSTALL_DIR"
  local plist_dir="${HOME}/Library/LaunchAgents"
  local plist_file="${plist_dir}/com.mrtoyy.convosketchpad.plist"

  mkdir -p "$plist_dir"

  # Create a wrapper script that launches the built server from the install dir.
  # server/lib/config.ts loads .env at runtime, so the wrapper should not source it
  # directly (raw .env values are dotenv-compatible but not necessarily shell-safe).
  local start_script="${working_dir}/start.sh"
  # The plist sets PATH in EnvironmentVariables, but the wrapper also needs
  # to find node if run manually. Bake the current node path as a fallback.
  local node_dir_escaped
  node_dir_escaped=$(dirname "${node_bin}")
  cat > "$start_script" <<STARTEOF
#!/bin/bash
# ConvoSketchpad start wrapper — .env is loaded by the Node server at runtime.
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
cd "\${SCRIPT_DIR}"
export PATH="${node_dir_escaped}:\${PATH}"
export NODE_ENV=production
exec node "\${SCRIPT_DIR}/server-dist/index.js"
STARTEOF
  chmod +x "$start_script"

  cat > "$plist_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mrtoyy.convosketchpad</string>
  <key>ProgramArguments</key>
  <array>
    <string>${start_script}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${working_dir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "${node_bin}"):/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${working_dir}/convosketchpad.log</string>
  <key>StandardErrorPath</key>
  <string>${working_dir}/convosketchpad.log</string>
</dict>
</plist>
EOF

  # launchctl bootstrap (modern) with fallback to load (legacy)
  local uid
  uid=$(id -u)
  if launchctl bootstrap "gui/${uid}" "$plist_file" 2>/dev/null; then
    ok "launchd service installed and started"
    info "ConvoSketchpad will start automatically on login"
  elif launchctl load "$plist_file" 2>/dev/null; then
    ok "launchd service installed and started (legacy loader)"
    info "ConvoSketchpad will start automatically on login"
  else
    ok "launchd plist created at ${plist_file}"
    info "Load it with: launchctl load ${plist_file}"
  fi
  echo ""
  info "Manage:"
  echo "    launchctl stop com.mrtoyy.convosketchpad"
  echo "    launchctl start com.mrtoyy.convosketchpad"
  echo "    launchctl unload ${plist_file}"
  echo ""
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  # ── macOS: launchd service ──────────────────────────────────────────
  plist_check="${HOME}/Library/LaunchAgents/com.mrtoyy.convosketchpad.plist"
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -f "$plist_check" ]]; then
      dry "launchd service already exists — would restart it"
    else
      dry "Would create launchd service (~/Library/LaunchAgents/com.mrtoyy.convosketchpad.plist)"
    fi
  else
    echo -e "${BOLD}  Service${NC}"
    echo ""
    if [[ -f "$plist_check" ]]; then
      info "Updating existing launchd service..."
      uid=$(id -u)
      launchctl bootout "gui/${uid}/com.mrtoyy.convosketchpad" 2>/dev/null || launchctl stop com.mrtoyy.convosketchpad 2>/dev/null || true
      setup_launchd
    elif [[ "$INTERACTIVE" == "true" ]]; then
      printf "  ${RAIL}  ${YELLOW}?${NC} Install as a launchd service (starts on login)? (Y/n) "
      if read -r answer < /dev/tty 2>/dev/null; then
        if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" != "n" ]]; then
          setup_launchd
        else
          ok "Skipped — start manually with: cd ${INSTALL_DIR} && npm run prod"
        fi
      else
        info "Cannot read input — installing launchd service by default"
        setup_launchd
      fi
    else
      info "Installing launchd service..."
      setup_launchd
    fi
    echo ""
  fi
elif command -v systemctl &>/dev/null; then
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -f /etc/systemd/system/convosketchpad.service ]]; then
      dry "Service already exists — would restart it"
    else
      dry "Would prompt to install systemd service"
      dry "Would create /etc/systemd/system/convosketchpad.service"
      dry "Would enable and start the service"
    fi
  else
    echo -e "${BOLD}  Systemd service${NC}"
    echo ""
    if [[ -f /etc/systemd/system/convosketchpad.service ]]; then
      info "Updating existing systemd service..."
      setup_systemd
    elif [[ "$INTERACTIVE" == "true" ]]; then
      printf "  ${RAIL}  ${YELLOW}?${NC} Install as a systemd service? (Y/n) "
      if read -r answer < /dev/tty 2>/dev/null; then
        if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" != "n" ]]; then
          setup_systemd
        else
          ok "Skipped — start manually with: cd ${INSTALL_DIR} && npm run prod"
        fi
      else
        info "Cannot read input — installing systemd service by default"
        setup_systemd
      fi
    else
      info "Non-interactive mode — installing systemd service"
      setup_systemd
    fi
    echo ""
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────
echo -e "  ${RAIL}"
echo -e "  ${GREEN}●${NC} ${GREEN}${BOLD}Done${NC}"
echo ""

# Detect port from .env
local_port=3080
if [[ -f "${INSTALL_DIR}/.env" ]]; then
  port_val=$(grep -E "^PORT=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 || true)
  [[ -n "$port_val" ]] && local_port="$port_val"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "     ${YELLOW}${BOLD}⊘  Dry run complete — nothing was modified${NC}"
  echo ""
  echo -e "     ${DIM}Run without --dry-run to install for real.${NC}"
else
  # Use the actual IP if HOST is 0.0.0.0 (network mode)
  host_val=$(grep -E "^HOST=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 || true)
  if [[ "$host_val" == "0.0.0.0" ]]; then
    detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "")
    local_url="http://${detected_ip:-localhost}:${local_port}"
  else
    local_url="http://localhost:${local_port}"
  fi
  url_len=${#local_url}
  # Box must fit both the header text and the URL, with breathing room
  header_len=29  # "Open ConvoSketchpad in your browser:" + padding
  url_line_len=$((url_len + 4))  # "→ " + url + padding
  if [[ $header_len -gt $url_line_len ]]; then
    box_inner=$((header_len + 4))
  else
    box_inner=$((url_line_len + 4))
  fi

  echo ""
  echo -e "     ${GREEN}${BOLD}✅ ConvoSketchpad installed!${NC}"
  echo ""
  echo -e "     ${ORANGE}╭$(printf '─%.0s' $(seq 1 $box_inner))╮${NC}"
  echo -e "     ${ORANGE}│${NC}$(printf ' %.0s' $(seq 1 $box_inner))${ORANGE}│${NC}"
  echo -e "     ${ORANGE}│${NC}  ${BOLD}Open ConvoSketchpad in your browser:${NC}$(printf ' %.0s' $(seq 1 $((box_inner - 29))))${ORANGE}│${NC}"
  echo -e "     ${ORANGE}│${NC}  ${CYAN}${BOLD}→ ${local_url}${NC}$(printf ' %.0s' $(seq 1 $((box_inner - url_len - 4))))${ORANGE}│${NC}"
  echo -e "     ${ORANGE}│${NC}$(printf ' %.0s' $(seq 1 $box_inner))${ORANGE}│${NC}"
  echo -e "     ${ORANGE}╰$(printf '─%.0s' $(seq 1 $box_inner))╯${NC}"
  echo ""
  print_deployment_guides || true
  echo ""
  echo -e "     ${DIM}Directory:  cd ${INSTALL_DIR}${NC}"
  if $IS_MAC; then
    echo -e "     ${DIM}Restart:   launchctl stop com.mrtoyy.convosketchpad && launchctl start com.mrtoyy.convosketchpad${NC}"
    echo -e "     ${DIM}Logs:      tail -f ${INSTALL_DIR}/convosketchpad.log${NC}"
  elif command -v systemctl &>/dev/null; then
    echo -e "     ${DIM}Restart:   sudo systemctl restart convosketchpad.service${NC}"
    echo -e "     ${DIM}Logs:      sudo journalctl -u convosketchpad.service -f${NC}"
  else
    echo -e "     ${DIM}Start:     cd ${INSTALL_DIR} && npm run prod${NC}"
  fi
fi
echo ""

# Exit code reflects actual readiness
if [[ "$DRY_RUN" == "true" ]]; then
  exit 0
fi

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  warn "Install complete but ConvoSketchpad is not fully configured"
  info "Run: cd ${INSTALL_DIR} && npm run setup"
  exit 2  # partial success — installed but non-functional
fi
exit 0
