#!/usr/bin/env bash
# verify-frankclaw-features.sh — Three-probe verification for frankclaw custom features
#
# Usage:
#   bash scripts/verify-frankclaw-features.sh static   # post-merge: grep for hook points
#   bash scripts/verify-frankclaw-features.sh test     # post-build: run frankclaw tests
#   bash scripts/verify-frankclaw-features.sh runtime  # post-restart: check log signatures
#   bash scripts/verify-frankclaw-features.sh all      # run all phases (stops on first failure)
#
# Reads feature definitions from frankclaw-features.json (repo root).
# Exit 0 = all probes passed, Exit 1 = one or more failed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FEATURES_JSON="$REPO_DIR/frankclaw-features.json"
GIT_COMMON_DIR="$(git -C "$REPO_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
CANONICAL_REPO_DIR="$REPO_DIR"
if [[ -n "$GIT_COMMON_DIR" && "$(basename "$GIT_COMMON_DIR")" == ".git" ]]; then
  CANONICAL_REPO_DIR="$(cd "$(dirname "$GIT_COMMON_DIR")" && pwd)"
fi

# Colors (if terminal supports it)
if [[ -t 1 ]]; then
  GREEN="\033[0;32m"
  RED="\033[0;31m"
  YELLOW="\033[0;33m"
  BOLD="\033[1m"
  RESET="\033[0m"
else
  GREEN=""; RED=""; YELLOW=""; BOLD=""; RESET=""
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() { echo -e "${RED}ERROR: $*${RESET}" >&2; exit 2; }

resolve_probe_path() {
  local file="$1"
  local full_path="$REPO_DIR/$file"
  if [[ -f "$full_path" ]]; then
    printf '%s\n' "$full_path"
    return 0
  fi
  if [[ "$CANONICAL_REPO_DIR" != "$REPO_DIR" ]]; then
    local canonical_full_path="$CANONICAL_REPO_DIR/$file"
    if [[ -f "$canonical_full_path" ]]; then
      printf '%s\n' "$canonical_full_path"
      return 0
    fi
  fi
  printf '%s\n' "$full_path"
}

require_jq() {
  command -v jq >/dev/null 2>&1 || die "jq is required but not installed. Run: sudo apt install jq"
}

# Read features JSON once
load_features() {
  [[ -f "$FEATURES_JSON" ]] || die "Feature registry not found: $FEATURES_JSON"
  FEATURE_COUNT=$(jq '.features | length' "$FEATURES_JSON")
  [[ "$FEATURE_COUNT" -gt 0 ]] || die "No features found in $FEATURES_JSON"
}

# ---------------------------------------------------------------------------
# Phase: REGISTRY (validate feature entries have required test paths)
# ---------------------------------------------------------------------------

run_registry() {
  echo -e "${BOLD}=== Frankclaw Feature Registry Validation ===${RESET}"
  echo ""

  local passed=0
  local failed=0
  local warnings=""

  for i in $(seq 0 $((FEATURE_COUNT - 1))); do
    local name
    name=$(jq -r ".features[$i].name" "$FEATURES_JSON")
    local test_count
    test_count=$(jq ".features[$i].tests | length" "$FEATURES_JSON")
    local e2e_count
    e2e_count=$(jq ".features[$i].e2eTests | length" "$FEATURES_JSON" 2>/dev/null || echo 0)
    local status
    status=$(jq -r ".features[$i].status // \"active\"" "$FEATURES_JSON")

    # Skip planned/inactive features
    if [[ "$status" == "planned" ]]; then
      echo -e "  ${YELLOW}⏭  $name (planned — skipped)${RESET}"
      continue
    fi

    local feature_ok=true

    if [[ "$test_count" -eq 0 ]]; then
      warnings="${warnings}\n   MISSING: $name has no unit tests registered"
      feature_ok=false
    fi

    if [[ "$e2e_count" -eq 0 ]]; then
      warnings="${warnings}\n   MISSING: $name has no e2e tests registered"
      feature_ok=false
    fi

    if [[ "$feature_ok" == "true" ]]; then
      echo -e "  ${GREEN}✅ $name (tests: $test_count, e2e: $e2e_count)${RESET}"
      passed=$((passed + 1))
    else
      echo -e "  ${RED}❌ $name (tests: $test_count, e2e: $e2e_count)${RESET}"
      failed=$((failed + 1))
    fi
  done

  echo ""
  if [[ "$failed" -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}RESULT: All $passed features have required test paths ✅${RESET}"
    return 0
  else
    echo -e "${RED}${BOLD}RESULT: $failed features MISSING required test paths${RESET}"
    echo -e "$warnings"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Phase: STATIC (grep for patterns in source files)
# ---------------------------------------------------------------------------

run_static() {
  echo -e "${BOLD}=== Frankclaw Feature Verification (static) ===${RESET}"
  echo ""

  local passed=0
  local failed=0
  local total_features="$FEATURE_COUNT"
  local fail_details=""

  for i in $(seq 0 $((FEATURE_COUNT - 1))); do
    local name
    name=$(jq -r ".features[$i].name" "$FEATURES_JSON")
    local probe_count
    probe_count=$(jq ".features[$i].static | length" "$FEATURES_JSON")

    if [[ "$probe_count" -eq 0 ]]; then
      echo -e "  ${YELLOW}⏭  $name (no static probes)${RESET}"
      total_features=$((total_features - 1))
      continue
    fi

    local probes_passed=0
    local feature_fails=""

    for j in $(seq 0 $((probe_count - 1))); do
      local file pattern min_count
      file=$(jq -r ".features[$i].static[$j].file" "$FEATURES_JSON")
      pattern=$(jq -r ".features[$i].static[$j].pattern" "$FEATURES_JSON")
      min_count=$(jq -r ".features[$i].static[$j].minCount // 1" "$FEATURES_JSON")

      local full_path
      full_path="$(resolve_probe_path "$file")"
      local actual_count=0

      if [[ -f "$full_path" ]]; then
        actual_count=$(grep -c "$pattern" "$full_path" 2>/dev/null) || actual_count=0
      fi

      if [[ "$actual_count" -ge "$min_count" ]]; then
        probes_passed=$((probes_passed + 1))
      else
        feature_fails="${feature_fails}\n   FAIL: $file missing \"$pattern\" (expected >=$min_count, found $actual_count)"
      fi
    done

    if [[ "$probes_passed" -eq "$probe_count" ]]; then
      echo -e "  ${GREEN}✅ $name ($probes_passed/$probe_count probes)${RESET}"
      passed=$((passed + 1))
    else
      echo -e "  ${RED}❌ $name ($probes_passed/$probe_count probes)${RESET}"
      echo -e "$feature_fails"
      failed=$((failed + 1))
      fail_details="${fail_details}\n❌ $name${feature_fails}"
    fi
  done

  echo ""
  if [[ "$failed" -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}RESULT: $passed/$total_features features passed ✅${RESET}"
    return 0
  else
    echo -e "${RED}${BOLD}RESULT: $passed/$total_features features passed, $failed FAILED${RESET}"
    # Write failure details to stdout for piping to alerts
    if [[ -n "${VERIFY_OUTPUT_FILE:-}" ]]; then
      echo -e "$fail_details" > "$VERIFY_OUTPUT_FILE"
    fi
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Phase: TEST (run vitest on frankclaw test files)
# ---------------------------------------------------------------------------

run_test() {
  echo -e "${BOLD}=== Frankclaw Feature Verification (test) ===${RESET}"
  echo ""

  # Collect all test files from the registry
  local test_files=()
  for i in $(seq 0 $((FEATURE_COUNT - 1))); do
    local test_count
    test_count=$(jq ".features[$i].tests | length" "$FEATURES_JSON")
    for j in $(seq 0 $((test_count - 1))); do
      local tf
      tf=$(jq -r ".features[$i].tests[$j]" "$FEATURES_JSON")
      if [[ -f "$REPO_DIR/$tf" ]]; then
        test_files+=("$tf")
      else
        echo -e "  ${YELLOW}⚠️  Test file not found: $tf${RESET}"
      fi
    done
  done

  if [[ ${#test_files[@]} -eq 0 ]]; then
    echo -e "  ${YELLOW}No test files registered in feature registry.${RESET}"
    echo ""
    echo -e "${YELLOW}${BOLD}RESULT: No tests to run (SKIP)${RESET}"
    return 0
  fi

  echo "  Running ${#test_files[@]} test file(s)..."
  echo ""

  cd "$REPO_DIR"
  local exit_code=0
  pnpm -s exec vitest run --reporter=verbose "${test_files[@]}" 2>&1 || exit_code=$?

  echo ""
  if [[ "$exit_code" -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}RESULT: All ${#test_files[@]} test file(s) passed ✅${RESET}"
    return 0
  else
    echo -e "${RED}${BOLD}RESULT: Tests FAILED (exit code $exit_code)${RESET}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Phase: E2E (run e2e tests registered in the feature registry)
# ---------------------------------------------------------------------------

run_e2e() {
  echo -e "${BOLD}=== Frankclaw Feature Verification (e2e) ===${RESET}"
  echo ""

  # Collect all e2e test files from the registry
  local e2e_files=()
  for i in $(seq 0 $((FEATURE_COUNT - 1))); do
    local e2e_count
    e2e_count=$(jq ".features[$i].e2eTests | length" "$FEATURES_JSON" 2>/dev/null || echo 0)
    for j in $(seq 0 $((e2e_count - 1))); do
      local tf
      tf=$(jq -r ".features[$i].e2eTests[$j]" "$FEATURES_JSON")
      if [[ -f "$REPO_DIR/$tf" ]]; then
        e2e_files+=("$tf")
      else
        echo -e "  ${YELLOW}⚠️  E2E test file not found: $tf${RESET}"
      fi
    done
  done

  if [[ ${#e2e_files[@]} -eq 0 ]]; then
    echo -e "  ${YELLOW}No e2e test files registered in feature registry.${RESET}"
    echo ""
    echo -e "${YELLOW}${BOLD}RESULT: No e2e tests to run (SKIP)${RESET}"
    return 0
  fi

  echo "  Running ${#e2e_files[@]} e2e test file(s)..."
  echo ""

  cd "$REPO_DIR"
  local exit_code=0
  pnpm -s exec vitest run --reporter=verbose "${e2e_files[@]}" 2>&1 || exit_code=$?

  echo ""
  if [[ "$exit_code" -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}RESULT: All ${#e2e_files[@]} e2e test file(s) passed ✅${RESET}"
    return 0
  else
    echo -e "${RED}${BOLD}RESULT: E2E Tests FAILED (exit code $exit_code)${RESET}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Phase: RUNTIME (check today's log for expected patterns after last gateway start)
# ---------------------------------------------------------------------------

run_runtime() {
  echo -e "${BOLD}=== Frankclaw Feature Verification (runtime) ===${RESET}"
  echo ""

  local today
  today=$(date +%Y-%m-%d)
  local log_file="/tmp/openclaw/openclaw-${today}.log"

  if [[ ! -f "$log_file" ]]; then
    echo -e "  ${RED}Log file not found: $log_file${RESET}"
    echo -e "${RED}${BOLD}RESULT: Cannot verify runtime (no log file)${RESET}"
    return 1
  fi

  # Find the timestamp of the last gateway start
  # Look for "heartbeat: started" or "health-monitor.*started" as gateway boot markers
  local last_start_line
  last_start_line=$(grep -n '"heartbeat: started"\|"health-monitor.*started"\|"Starting gateway"\|"Gateway started"' "$log_file" 2>/dev/null | tail -1 | cut -d: -f1 || true)

  if [[ -z "$last_start_line" ]]; then
    echo -e "  ${YELLOW}⚠️  No gateway start marker found in today's log. Checking entire log.${RESET}"
    last_start_line=1
  else
    echo -e "  Gateway last started at log line $last_start_line"
  fi

  # Write log tail to temp file for efficient grepping
  local log_tail_file
  log_tail_file=$(mktemp /tmp/frankclaw-verify-runtime.XXXXXX)
  trap "rm -f '$log_tail_file'" EXIT
  tail -n +"$last_start_line" "$log_file" > "$log_tail_file"

  local passed=0
  local failed=0
  local total=0
  local fail_details=""

  for i in $(seq 0 $((FEATURE_COUNT - 1))); do
    local name
    name=$(jq -r ".features[$i].name" "$FEATURES_JSON")
    local runtime_count
    runtime_count=$(jq ".features[$i].runtime | length" "$FEATURES_JSON")

    if [[ "$runtime_count" -eq 0 ]]; then
      continue
    fi

    total=$((total + 1))
    local probes_passed=0

    local on_event_count=0
    for j in $(seq 0 $((runtime_count - 1))); do
      local log_pattern
      log_pattern=$(jq -r ".features[$i].runtime[$j].logPattern" "$FEATURES_JSON")
      local within_seconds
      within_seconds=$(jq -r ".features[$i].runtime[$j].withinSeconds // 0" "$FEATURES_JSON")
      local on_event
      on_event=$(jq -r ".features[$i].runtime[$j].onEvent // false" "$FEATURES_JSON")

      # Re-read the log tail fresh for each probe attempt
      tail -n +"$last_start_line" "$log_file" > "$log_tail_file"

      local match_count
      match_count=$(grep -cF "$log_pattern" "$log_tail_file" 2>/dev/null) || match_count=0

      # If not found and withinSeconds > 0, retry with backoff up to that limit
      if [[ "$match_count" -eq 0 ]] && [[ "$within_seconds" -gt 0 ]]; then
        local waited=0
        local interval=10
        while [[ "$waited" -lt "$within_seconds" ]]; do
          sleep "$interval"
          waited=$((waited + interval))
          tail -n +"$last_start_line" "$log_file" > "$log_tail_file"
          match_count=$(grep -cF "$log_pattern" "$log_tail_file" 2>/dev/null) || match_count=0
          if [[ "$match_count" -gt 0 ]]; then
            break
          fi
          echo -e "  ${YELLOW}⏳ Waiting for \"$log_pattern\" (${waited}s/${within_seconds}s)${RESET}"
        done
      fi

      if [[ "$match_count" -gt 0 ]]; then
        probes_passed=$((probes_passed + 1))
      elif [[ "$on_event" == "true" ]]; then
        # Event-triggered probes only fire on specific actions (e.g., Discord msg, sessions.send).
        # Not finding them after restart is expected. Count as passed.
        probes_passed=$((probes_passed + 1))
        on_event_count=$((on_event_count + 1))
      else
        fail_details="${fail_details}\n   FAIL: Log pattern \"$log_pattern\" not found after last gateway start (waited ${within_seconds:-0}s)"
      fi
    done

    if [[ "$probes_passed" -eq "$runtime_count" ]]; then
      if [[ "$on_event_count" -gt 0 ]]; then
        echo -e "  ${GREEN}✅ $name ($((probes_passed - on_event_count))/$runtime_count verified, $on_event_count event-triggered skipped)${RESET}"
      else
        echo -e "  ${GREEN}✅ $name ($probes_passed/$runtime_count runtime probes)${RESET}"
      fi
      passed=$((passed + 1))
    else
      echo -e "  ${RED}❌ $name ($probes_passed/$runtime_count runtime probes)${RESET}"
      echo -e "   FAIL: Log pattern not found after last gateway start"
      failed=$((failed + 1))
    fi
  done

  if [[ "$total" -eq 0 ]]; then
    echo -e "  ${YELLOW}No runtime probes registered in feature registry.${RESET}"
    echo ""
    echo -e "${YELLOW}${BOLD}RESULT: No runtime probes to check (SKIP)${RESET}"
    return 0
  fi

  echo ""
  if [[ "$failed" -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}RESULT: $passed/$total runtime features verified ✅${RESET}"
    return 0
  else
    echo -e "${RED}${BOLD}RESULT: $passed/$total runtime features verified, $failed FAILED${RESET}"
    if [[ -n "${VERIFY_OUTPUT_FILE:-}" ]]; then
      echo -e "$fail_details" > "$VERIFY_OUTPUT_FILE"
    fi
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Phase: CHANNELS (pre-restart channel health check)
# ---------------------------------------------------------------------------

run_channels() {
  echo -e "${BOLD}=== Frankclaw Channel Health Check ===${RESET}"
  echo ""

  local openclaw_bin
  openclaw_bin=$(command -v openclaw 2>/dev/null || echo "")
  if [[ -z "$openclaw_bin" ]]; then
    echo -e "  ${YELLOW}⚠️  openclaw CLI not found — skipping channel check${RESET}"
    return 0
  fi

  local output
  output=$(openclaw channels status --probe 2>&1) || true

  # Check for config read errors (plugin load failures, Invalid config)
  local config_errors=0
  if echo "$output" | grep -q "Failed to read config\|Invalid config\|Cannot read properties"; then
    config_errors=1
  fi

  # Check for channel-specific errors
  local channel_errors=0
  local error_channels=""
  while IFS= read -r line; do
    if echo "$line" | grep -qE "^- .+ error:"; then
      local ch_name
      ch_name=$(echo "$line" | sed 's/^- \([^ ]*\).*/\1/')
      # Skip disabled channels
      if echo "$line" | grep -q "error:disabled"; then
        continue
      fi
      channel_errors=$((channel_errors + 1))
      error_channels="${error_channels}\n   ERROR: $ch_name — $(echo "$line" | grep -oP 'error:.*')"
    fi
  done <<< "$output"

  if [[ "$config_errors" -gt 0 ]]; then
    echo -e "  ${RED}❌ Config read error detected${RESET}"
    echo "$output" | grep -E "Failed to read config|Invalid config|Cannot read properties|plugin manifest not found" | head -5 | while read -r line; do
      echo -e "   ${RED}$line${RESET}"
    done
    echo ""
    echo -e "${RED}${BOLD}RESULT: Channel health check FAILED — config errors will prevent channels from starting${RESET}"
    return 1
  fi

  if [[ "$channel_errors" -gt 0 ]]; then
    echo -e "  ${YELLOW}⚠️  $channel_errors channel(s) have errors:${RESET}"
    echo -e "$error_channels"
  fi

  # Show channel summary
  echo "$output" | grep -E "^- " | while read -r line; do
    if echo "$line" | grep -q "works"; then
      echo -e "  ${GREEN}✅ $line${RESET}"
    elif echo "$line" | grep -q "error:disabled"; then
      echo -e "  ${YELLOW}⏭  $line${RESET}"
    else
      echo -e "  ${YELLOW}⚠️  $line${RESET}"
    fi
  done

  echo ""
  if [[ "$channel_errors" -gt 0 ]]; then
    echo -e "${YELLOW}${BOLD}RESULT: $channel_errors channel(s) have errors (non-blocking)${RESET}"
  else
    echo -e "${GREEN}${BOLD}RESULT: Channel health check passed ✅${RESET}"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Phase: PREBUILD (detect stale pre-built .js files shadowing .ts sources)
# ---------------------------------------------------------------------------

run_prebuild() {
  echo -e "${BOLD}=== Frankclaw Pre-built Bundle Shadow Check ===${RESET}"
  echo ""

  local shadow_count=0
  local shadow_list=""
  while IFS= read -r jsfile; do
    local tsfile="${jsfile%.js}.ts"
    if [[ -f "$tsfile" ]]; then
      local jssize
      jssize=$(stat -c%s "$jsfile" 2>/dev/null || stat -f%z "$jsfile" 2>/dev/null || echo 0)
      if [[ "$jssize" -gt 100000 ]]; then
        shadow_count=$((shadow_count + 1))
        local rel="${jsfile#"$REPO_DIR"/}"
        shadow_list="${shadow_list}\n   ${RED}$rel${RESET} ($(numfmt --to=iec "$jssize" 2>/dev/null || echo "${jssize}B")) shadows ${rel%.js}.ts"
      fi
    fi
  done < <(find "$REPO_DIR/extensions" -name "*.js" -not -path "*/node_modules/*" 2>/dev/null)

  if [[ "$shadow_count" -gt 0 ]]; then
    echo -e "  ${RED}❌ Found $shadow_count stale pre-built .js bundle(s) shadowing .ts sources:${RESET}"
    echo -e "$shadow_list"
    echo ""
    echo -e "  ${YELLOW}Fix: delete the stale .js files so the bundler compiles from .ts source.${RESET}"
    echo ""
    echo -e "${RED}${BOLD}RESULT: Pre-built bundle shadow check FAILED${RESET}"
    return 1
  fi

  echo -e "  ${GREEN}✅ No stale pre-built .js bundles shadowing .ts sources${RESET}"
  echo ""
  echo -e "${GREEN}${BOLD}RESULT: Pre-built bundle shadow check passed ✅${RESET}"
  return 0
}

# ---------------------------------------------------------------------------
# Phase: WORKSPACE (verify workspace infrastructure checks from registry)
# ---------------------------------------------------------------------------

run_workspace() {
  echo -e "${BOLD}=== Frankclaw Workspace Infrastructure Check ===${RESET}"
  echo ""

  local check_count
  check_count=$(jq '.workspaceChecks | length' "$FEATURES_JSON" 2>/dev/null || echo 0)

  if [[ "$check_count" -eq 0 ]]; then
    echo -e "  ${YELLOW}No workspace checks registered.${RESET}"
    echo ""
    echo -e "${YELLOW}${BOLD}RESULT: No workspace checks (SKIP)${RESET}"
    return 0
  fi

  local passed=0
  local failed=0
  local fixed=0

  for i in $(seq 0 $((check_count - 1))); do
    local name
    name=$(jq -r ".workspaceChecks[$i].name" "$FEATURES_JSON")
    local fix_cmd
    fix_cmd=$(jq -r ".workspaceChecks[$i].fix // \"\"" "$FEATURES_JSON")
    local inner_count
    inner_count=$(jq ".workspaceChecks[$i].checks | length" "$FEATURES_JSON")
    local all_ok=true

    for j in $(seq 0 $((inner_count - 1))); do
      local check_type check_path check_target
      check_type=$(jq -r ".workspaceChecks[$i].checks[$j].type" "$FEATURES_JSON")
      check_path=$(jq -r ".workspaceChecks[$i].checks[$j].path" "$FEATURES_JSON")
      check_target=$(jq -r ".workspaceChecks[$i].checks[$j].target // \"\"" "$FEATURES_JSON")

      # Expand ~ to $HOME
      check_path="${check_path/#\~/$HOME}"
      check_target="${check_target/#\~/$HOME}"

      if [[ "$check_type" == "symlink" ]]; then
        if [[ -L "$check_path" ]]; then
          local actual_target
          actual_target=$(readlink "$check_path")
          local expected_target="$check_target"
          if [[ "$actual_target" == "$expected_target" ]]; then
            continue
          else
            echo -e "  ${RED}  WRONG TARGET: $check_path -> $actual_target (expected $expected_target)${RESET}"
            all_ok=false
          fi
        else
          echo -e "  ${RED}  MISSING: $check_path${RESET}"
          all_ok=false
        fi
      elif [[ "$check_type" == "file" ]]; then
        if [[ ! -f "$check_path" ]]; then
          echo -e "  ${RED}  MISSING: $check_path${RESET}"
          all_ok=false
        fi
      elif [[ "$check_type" == "json_value" ]]; then
        local json_path check_expected actual_value
        json_path=$(jq -r ".workspaceChecks[$i].checks[$j].jsonPath" "$FEATURES_JSON")
        check_expected=$(jq -r ".workspaceChecks[$i].checks[$j].expected" "$FEATURES_JSON")
        if [[ -f "$check_path" ]]; then
          actual_value=$(python3 -c "
import json,sys
d=json.load(open('$check_path'))
keys='$json_path'.split('.')
for k in keys:
  d=d.get(k,{}) if isinstance(d,dict) else None
  if d is None: break
print(d if d is not None else 'NULL')
" 2>/dev/null)
          if [[ "$actual_value" != "$check_expected" ]]; then
            echo -e "  ${RED}  WRONG: $check_path $json_path=$actual_value (expected $check_expected)${RESET}"
            all_ok=false
          fi
        else
          echo -e "  ${RED}  MISSING: $check_path${RESET}"
          all_ok=false
        fi
      fi
    done

    if [[ "$all_ok" == "true" ]]; then
      echo -e "  ${GREEN}✅ $name${RESET}"
      passed=$((passed + 1))
    else
      if [[ -n "$fix_cmd" ]] && [[ "${WORKSPACE_AUTOFIX:-0}" == "1" ]]; then
        echo -e "  ${YELLOW}🔧 Attempting fix: $fix_cmd${RESET}"
        eval "${fix_cmd/#\~/$HOME}" 2>/dev/null && {
          echo -e "  ${GREEN}✅ $name (auto-fixed)${RESET}"
          fixed=$((fixed + 1))
          passed=$((passed + 1))
        } || {
          echo -e "  ${RED}❌ $name (fix failed)${RESET}"
          failed=$((failed + 1))
        }
      else
        echo -e "  ${RED}❌ $name${RESET}"
        if [[ -n "$fix_cmd" ]]; then
          echo -e "  ${YELLOW}  Fix: $fix_cmd${RESET}"
        fi
        failed=$((failed + 1))
      fi
    fi
  done

  echo ""
  if [[ "$failed" -eq 0 ]]; then
    local extra=""
    [[ "$fixed" -gt 0 ]] && extra=" ($fixed auto-fixed)"
    echo -e "${GREEN}${BOLD}RESULT: $passed/$check_count workspace checks passed${extra} ✅${RESET}"
    return 0
  else
    echo -e "${RED}${BOLD}RESULT: $passed/$check_count passed, $failed FAILED. Run with WORKSPACE_AUTOFIX=1 to auto-fix.${RESET}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Phase: ALL (run static, test, runtime in sequence)
# ---------------------------------------------------------------------------

run_all() {
  run_registry || { echo -e "\n${RED}Registry validation failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_prebuild || { echo -e "\n${RED}Pre-built bundle shadow check failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_workspace || { echo -e "\n${RED}Workspace infrastructure check failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_static || { echo -e "\n${RED}Static phase failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_test || { echo -e "\n${RED}Test phase failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_e2e || { echo -e "\n${RED}E2E phase failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_channels || { echo -e "\n${RED}Channel health check failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_runtime || { echo -e "\n${RED}Runtime phase failed. Stopping.${RESET}"; return 1; }
  echo ""
  echo -e "${GREEN}${BOLD}=== All phases passed ✅ ===${RESET}"
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

require_jq
load_features

PHASE="${1:-all}"

case "$PHASE" in
  registry)  run_registry ;;
  prebuild)  run_prebuild ;;
  workspace) run_workspace ;;
  static)    run_static ;;
  test)      run_test ;;
  e2e)       run_e2e ;;
  channels)  run_channels ;;
  runtime)   run_runtime ;;
  all)       run_all ;;
  *)         die "Unknown phase: $PHASE. Use: registry, prebuild, workspace, static, test, e2e, channels, runtime, or all" ;;
esac
