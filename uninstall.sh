#!/usr/bin/env bash

set -u
set -o pipefail

PRODUCT_NAME="ConvoSketchpad"
SYSTEMD_UNIT="convosketchpad.service"
LAUNCHD_LABEL="com.mrtoyy.convosketchpad"
DRY_RUN="false"
FAILURES=0
REMOVED_RESOURCES=0

usage() {
  cat <<'EOF'
Unregister the ConvoSketchpad managed service without deleting program or user data.

Usage:
  ./uninstall.sh [--dry-run] [--help]
  npm run uninstall -- [--dry-run]

Options:
  --dry-run  Show what would be unregistered or removed without changing anything.
  --help     Show this help.

The script never deletes the installation directory, .env, Canvas database,
Artifacts, Gateway credentials, updater snapshots, OpenClaw state, or
Tailscale configuration.
EOF
}

info() {
  printf '  %s\n' "$*"
}

ok() {
  printf '  ✓ %s\n' "$*"
}

warn() {
  printf '  ! %s\n' "$*" >&2
}

fail() {
  printf '  ✗ %s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}

print_command() {
  local arg
  printf '    '
  for arg in "$@"; do
    printf '%q ' "$arg"
  done
  printf '\n'
}

canonical_directory() {
  (
    cd "$1" 2>/dev/null || exit 1
    pwd -P
  )
}

canonical_file() {
  local file_path="$1"
  local parent
  local name
  parent=$(dirname "$file_path")
  name=$(basename "$file_path")
  if parent=$(canonical_directory "$parent"); then
    printf '%s/%s\n' "$parent" "$name"
  else
    printf '%s\n' "$file_path"
  fi
}

strip_outer_quotes() {
  local value="$1"
  case "$value" in
    \"*\")
      value="${value#\"}"
      value="${value%\"}"
      ;;
    \'*\')
      value="${value#\'}"
      value="${value%\'}"
      ;;
  esac
  printf '%s\n' "$value"
}

read_env_value() {
  local key="$1"
  local env_file="$2"
  local line
  [[ -f "$env_file" ]] || return 1
  line=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" 2>/dev/null | tail -n 1) || return 1
  line="${line#*=}"
  line=$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  strip_outer_quotes "$line"
}

read_package_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "${INSTALL_ROOT}/package.json" | head -n 1
}

resolve_data_directory() {
  local configured="${CONVOSKETCHPAD_DATA_DIR:-}"
  if [[ -z "$configured" ]]; then
    configured=$(read_env_value "CONVOSKETCHPAD_DATA_DIR" "${INSTALL_ROOT}/.env" || true)
  fi
  if [[ -z "$configured" ]]; then
    configured="${HOME}/.convosketchpad"
  elif [[ "$configured" != /* ]]; then
    configured="${INSTALL_ROOT}/${configured}"
  fi

  if [[ -d "$configured" ]]; then
    canonical_directory "$configured"
  else
    printf '%s\n' "$configured"
  fi
}

path_status() {
  if [[ -e "$1" ]]; then
    printf '%s' "$1"
  else
    printf '%s (not found)' "$1"
  fi
}

remove_file() {
  local target="$1"
  local privileged="${2:-false}"
  if [[ "$DRY_RUN" == "true" ]]; then
    info "Would remove $(canonical_file "$target")"
    return 0
  fi

  if [[ "$privileged" == "true" && "$EUID" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      return 1
    fi
    sudo rm -f -- "$target"
  else
    rm -f -- "$target"
  fi
}

plist_value() {
  local plist="$1"
  local key="$2"
  plutil -extract "$key" raw -o - "$plist" 2>/dev/null
}

is_generated_launchd_wrapper() {
  local wrapper="$1"
  local line_count
  local path_line
  line_count=$(wc -l < "$wrapper" | tr -d '[:space:]')
  [[ "$line_count" == "7" ]] || return 1
  [[ "$(sed -n '1p' "$wrapper")" == "#!/bin/bash" ]] || return 1
  [[ "$(sed -n '2p' "$wrapper")" == \
    "# ConvoSketchpad start wrapper — .env is loaded by the Node server at runtime." ]] || return 1
  [[ "$(sed -n '3p' "$wrapper")" == \
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"' ]] || return 1
  [[ "$(sed -n '4p' "$wrapper")" == 'cd "${SCRIPT_DIR}"' ]] || return 1
  path_line=$(sed -n '5p' "$wrapper")
  case "$path_line" in
    'export PATH="'*':${PATH}"') ;;
    *) return 1 ;;
  esac
  [[ "$(sed -n '6p' "$wrapper")" == "export NODE_ENV=production" ]] || return 1
  [[ "$(sed -n '7p' "$wrapper")" == \
    'exec node "${SCRIPT_DIR}/server-dist/index.js"' ]] || return 1
}

cleanup_launchd() {
  local plist="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
  local wrapper="${INSTALL_ROOT}/start.sh"
  local wrapper_referenced="false"
  local loaded="false"
  local uid
  local label=""
  local working_directory=""
  local program_argument=""
  local canonical_working=""
  local canonical_program=""

  info "Checking macOS launchd service..."
  if command -v launchctl >/dev/null 2>&1; then
    uid=$(id -u)
    if launchctl print "gui/${uid}/${LAUNCHD_LABEL}" >/dev/null 2>&1; then
      loaded="true"
    fi
  else
    uid=$(id -u)
  fi

  if [[ -f "$plist" ]]; then
    if ! command -v plutil >/dev/null 2>&1; then
      fail "Cannot inspect ${plist}: plutil is unavailable"
      return
    fi
    label=$(plist_value "$plist" "Label" || true)
    working_directory=$(plist_value "$plist" "WorkingDirectory" || true)
    program_argument=$(plist_value "$plist" "ProgramArguments.0" || true)
    [[ -n "$working_directory" ]] && canonical_working=$(canonical_directory "$working_directory" || true)
    [[ -n "$program_argument" ]] && canonical_program=$(canonical_file "$program_argument")
    if [[ "$canonical_program" == "$wrapper" ]]; then
      wrapper_referenced="true"
    fi

    if [[ "$label" != "$LAUNCHD_LABEL" \
      || "$canonical_working" != "$INSTALL_ROOT" \
      || "$canonical_program" != "$wrapper" ]]; then
      warn "Leaving ${plist}: it does not belong to ${INSTALL_ROOT}"
    elif ! command -v launchctl >/dev/null 2>&1; then
      fail "Cannot unregister ${LAUNCHD_LABEL}: launchctl is unavailable"
    else
      if [[ "$loaded" == "true" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
          info "Would boot out ${LAUNCHD_LABEL}"
        elif ! launchctl bootout "gui/${uid}/${LAUNCHD_LABEL}" >/dev/null 2>&1; then
          fail "Could not boot out ${LAUNCHD_LABEL}; service files were preserved"
          return
        else
          ok "Stopped and unregistered ${LAUNCHD_LABEL}"
        fi
      else
        info "${LAUNCHD_LABEL} is not loaded"
      fi

      if remove_file "$plist"; then
        [[ "$DRY_RUN" == "true" ]] || ok "Removed ${plist}"
        REMOVED_RESOURCES=$((REMOVED_RESOURCES + 1))
        wrapper_referenced="false"
      else
        fail "Could not remove ${plist}; generated wrapper was preserved"
        return
      fi
    fi
  elif [[ "$loaded" == "true" ]]; then
    warn "${LAUNCHD_LABEL} is loaded without its expected plist; leaving it unchanged"
    wrapper_referenced="true"
  else
    info "No matching launchd plist found"
  fi

  if [[ -f "$wrapper" ]]; then
    if [[ "$wrapper_referenced" == "true" ]]; then
      warn "Preserving ${wrapper} because a remaining service may reference it"
    elif is_generated_launchd_wrapper "$wrapper"; then
      if remove_file "$wrapper"; then
        [[ "$DRY_RUN" == "true" ]] || ok "Removed generated ${wrapper}"
        REMOVED_RESOURCES=$((REMOVED_RESOURCES + 1))
      else
        fail "Could not remove generated ${wrapper}"
      fi
    else
      warn "Preserving ${wrapper}: it does not exactly match the generated wrapper template"
    fi
  fi
}

systemctl_for_scope() {
  local scope="$1"
  shift
  if [[ "$scope" == "user" ]]; then
    systemctl --user "$@"
  else
    systemctl "$@"
  fi
}

systemctl_mutation() {
  local scope="$1"
  shift
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ "$scope" == "user" ]]; then
      print_command systemctl --user "$@"
    elif [[ "$EUID" -eq 0 ]]; then
      print_command systemctl "$@"
    else
      print_command sudo systemctl "$@"
    fi
    return 0
  fi

  if [[ "$scope" == "user" ]]; then
    systemctl --user "$@"
  elif [[ "$EUID" -eq 0 ]]; then
    systemctl "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl "$@"
  else
    return 1
  fi
}

fallback_systemd_fragment() {
  local scope="$1"
  if [[ "$scope" == "user" ]]; then
    printf '%s/.config/systemd/user/%s\n' "$HOME" "$SYSTEMD_UNIT"
  else
    printf '/etc/systemd/system/%s\n' "$SYSTEMD_UNIT"
  fi
}

cleanup_systemd_scope() {
  local scope="$1"
  local fragment=""
  local fallback
  local working_directory=""
  local exec_start=""
  local exec_binary=""
  local exec_argument=""
  local canonical_working=""
  local scope_label="$scope"
  local active="false"
  local enabled="false"
  local privileged="false"

  fallback=$(fallback_systemd_fragment "$scope")
  if command -v systemctl >/dev/null 2>&1; then
    fragment=$(systemctl_for_scope "$scope" show "$SYSTEMD_UNIT" \
      --property=FragmentPath --value 2>/dev/null || true)
  fi
  if [[ -z "$fragment" && -f "$fallback" ]]; then
    fragment="$fallback"
  fi
  [[ -n "$fragment" ]] || return

  if [[ ! -f "$fragment" ]]; then
    warn "Leaving ${scope_label} ${SYSTEMD_UNIT}: fragment path is unavailable (${fragment})"
    return
  fi
  if [[ "$(basename "$fragment")" != "$SYSTEMD_UNIT" ]]; then
    warn "Leaving ${scope_label} unit with unexpected fragment path: ${fragment}"
    return
  fi

  working_directory=$(sed -n 's/^[[:space:]]*WorkingDirectory[[:space:]]*=[[:space:]]*//p' "$fragment" | head -n 1)
  exec_start=$(sed -n 's/^[[:space:]]*ExecStart[[:space:]]*=[[:space:]]*//p' "$fragment" | head -n 1)
  [[ -n "$working_directory" ]] && canonical_working=$(canonical_directory "$working_directory" || true)
  exec_binary="${exec_start%% *}"
  exec_argument="${exec_start#"$exec_binary"}"
  exec_argument="${exec_argument# }"
  if [[ "$canonical_working" != "$INSTALL_ROOT" \
    || "$(basename "$exec_binary")" != "node" \
    || ( "$exec_argument" != "server-dist/index.js" \
      && "$exec_argument" != "${INSTALL_ROOT}/server-dist/index.js" ) ]]; then
    warn "Leaving ${scope_label} ${SYSTEMD_UNIT}: it does not belong to ${INSTALL_ROOT}"
    return
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    fail "Cannot unregister ${scope_label} ${SYSTEMD_UNIT}: systemctl is unavailable"
    return
  fi

  systemctl_for_scope "$scope" is-active --quiet "$SYSTEMD_UNIT" >/dev/null 2>&1 && active="true"
  systemctl_for_scope "$scope" is-enabled --quiet "$SYSTEMD_UNIT" >/dev/null 2>&1 && enabled="true"
  [[ "$scope" == "system" ]] && privileged="true"

  if [[ "$active" == "true" ]]; then
    if ! systemctl_mutation "$scope" stop "$SYSTEMD_UNIT"; then
      fail "Could not stop ${scope_label} ${SYSTEMD_UNIT}; unit file was preserved"
      return
    fi
    [[ "$DRY_RUN" == "true" ]] || ok "Stopped ${scope_label} ${SYSTEMD_UNIT}"
  fi
  if [[ "$enabled" == "true" ]]; then
    if ! systemctl_mutation "$scope" disable "$SYSTEMD_UNIT"; then
      fail "Could not disable ${scope_label} ${SYSTEMD_UNIT}; unit file was preserved"
      return
    fi
    [[ "$DRY_RUN" == "true" ]] || ok "Disabled ${scope_label} ${SYSTEMD_UNIT}"
  fi

  if ! remove_file "$fragment" "$privileged"; then
    fail "Could not remove ${fragment}"
    return
  fi
  [[ "$DRY_RUN" == "true" ]] || ok "Removed ${fragment}"
  REMOVED_RESOURCES=$((REMOVED_RESOURCES + 1))

  if ! systemctl_mutation "$scope" daemon-reload; then
    fail "Removed ${fragment}, but systemd daemon-reload failed"
    return
  fi
  [[ "$DRY_RUN" == "true" ]] || ok "Reloaded ${scope_label} systemd manager"
}

cleanup_systemd() {
  info "Checking systemd services..."
  cleanup_systemd_scope "system"
  cleanup_systemd_scope "user"
  if [[ "$REMOVED_RESOURCES" -eq 0 && "$FAILURES" -eq 0 ]]; then
    info "No matching systemd unit found"
  fi
}

print_data_locations() {
  local data_directory
  data_directory=$(resolve_data_directory)

  printf '\nUser data was not deleted:\n'
  info "Configuration: $(path_status "${INSTALL_ROOT}/.env")"
  info "Canvas database: $(path_status "${INSTALL_ROOT}/database/canvas.sqlite")"
  info "Attachments and Artifacts: $(path_status "${INSTALL_ROOT}/artifacts")"
  info "Gateway credentials and updater state: $(path_status "$data_directory")"
  info "Installation directory: ${INSTALL_ROOT}"

  if [[ "$FAILURES" -ne 0 ]]; then
    printf '\n'
    warn "Service cleanup did not complete. Do not delete the installation directory yet."
    return
  fi

  printf '\n'
  printf '  ! The following command deletes the program directory and any .env, database,\n'
  printf '  ! Artifacts, logs, and other files stored inside it. Review the paths above first.\n'
  info "Run manually only when you are ready:"
  print_command rm -rf -- "$INSTALL_ROOT"
}

print_service_restore_hint() {
  local package_version
  package_version=$(read_package_version)
  printf '\nTo register and start the managed service again using the existing configuration:\n'
  if [[ "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_command "${INSTALL_ROOT}/install.sh" \
      --dir "$INSTALL_ROOT" \
      --version "v${package_version}" \
      --skip-setup
  else
    print_command "${INSTALL_ROOT}/install.sh" --dir "$INSTALL_ROOT" --skip-setup
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIRECTORY=$(dirname "${BASH_SOURCE[0]}")
INSTALL_ROOT=$(canonical_directory "$SCRIPT_DIRECTORY") || {
  printf 'Could not resolve the ConvoSketchpad installation directory.\n' >&2
  exit 1
}

if [[ "$INSTALL_ROOT" == "/" || "$INSTALL_ROOT" == "${HOME:-}" ]]; then
  printf 'Refusing to operate on unsafe installation directory: %s\n' "$INSTALL_ROOT" >&2
  exit 1
fi
if [[ ! -f "${INSTALL_ROOT}/package.json" ]] \
  || ! grep -Eq '"name"[[:space:]]*:[[:space:]]*"convosketchpad"' "${INSTALL_ROOT}/package.json"; then
  printf 'Refusing to operate: %s is not a ConvoSketchpad installation.\n' "$INSTALL_ROOT" >&2
  exit 1
fi

printf '%s service uninstaller\n' "$PRODUCT_NAME"
info "Installation: ${INSTALL_ROOT}"
[[ "$DRY_RUN" == "true" ]] && info "Dry run: no files or services will be changed"
printf '\n'

case "$(uname -s)" in
  Darwin)
    cleanup_launchd
    ;;
  Linux)
    cleanup_systemd
    ;;
  *)
    fail "Unsupported operating system: $(uname -s)"
    ;;
esac

print_data_locations

if [[ "$FAILURES" -ne 0 ]]; then
  exit 1
fi

if [[ "$DRY_RUN" == "true" ]]; then
  printf '\nDry run complete.\n'
elif [[ "$REMOVED_RESOURCES" -eq 0 ]]; then
  printf '\nNo matching managed service resources were present.\n'
else
  printf '\nService cleanup complete. Program and user data remain in place.\n'
fi

print_service_restore_hint
