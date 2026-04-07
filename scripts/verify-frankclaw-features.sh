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

      local full_path="$REPO_DIR/$file"
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
  last_start_line=$(grep -n '"heartbeat: started"\|"health-monitor.*started"\|"Starting gateway"\|"Gateway started"' "$log_file" | tail -1 | cut -d: -f1)

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
# Phase: ALL (run static, test, runtime in sequence)
# ---------------------------------------------------------------------------

run_all() {
  run_static || { echo -e "\n${RED}Static phase failed. Stopping.${RESET}"; return 1; }
  echo ""
  run_test || { echo -e "\n${RED}Test phase failed. Stopping.${RESET}"; return 1; }
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
  static)  run_static ;;
  test)    run_test ;;
  runtime) run_runtime ;;
  all)     run_all ;;
  *)       die "Unknown phase: $PHASE. Use: static, test, runtime, or all" ;;
esac
