#!/usr/bin/env zsh
# Pure Zsh browser benchmark suite for Mise Browser and comparison targets

emulate -L zsh
setopt extendedglob

zmodload zsh/datetime 2>/dev/null || true

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
RESULTS_DIR="${PROJECT_ROOT}/benchmarks/results"
URLS_DIR="${PROJECT_ROOT}/benchmarks/urls"

# Ensure output directory exists
[[ ! -d "$RESULTS_DIR" ]] && mkdir -p "$RESULTS_DIR"

benchmark_help() {
  print "Mise Browser Performance Benchmark Suite"
  print ""
  print "Usage: ./scripts/benchmark.zsh <command> [options] [target]"
  print ""
  print "Commands:"
  print "  measure <target>    Sample an active browser instance for N seconds"
  print "  run <target>        Launch browser with test suite, settle, and sample"
  print "  compare [f1] [f2]   Compare two benchmark JSON result files"
  print "  report              Generate Markdown summary from latest results"
  print "  hibernation         Test memory reclamation before and after tab sleep"
  print "  help                Show this help overview"
  print ""
  print "Targets:"
  print "  mise                Mise Browser (default)"
  print "  brave               Brave Origin / Brave Browser"
  print "  chromium            Chromium"
  print "  firefox             Firefox"
  print ""
  print "Options:"
  print "  -d <seconds>        Sampling duration in seconds (default: 5)"
  print "  -w <seconds>        Settle wait time before sampling (default: 20)"
  print "  -s <5|10|15>        Preset URL suite size (default: 10)"
  print "  -u <file>           Custom URL list file"
  print "  -t <tabs>           Explicit tab count label for record (default: 10)"
  print "  -h                  Show this help overview"
  print ""
}

# Resolve target matching and launch binary
benchmark_resolve_target() {
  local target="${1:-mise}"
  case "$target" in
    mise)
      TARGET_LABEL="Mise Browser"
      TARGET_NAME="mise"
      LAUNCH_CMD="npm start"
      ;;
    brave|brave-origin)
      TARGET_LABEL="Brave Origin"
      TARGET_NAME="brave"
      if command -v brave-origin >/dev/null 2>&1; then
        LAUNCH_CMD="brave-origin"
      elif command -v brave >/dev/null 2>&1; then
        LAUNCH_CMD="brave"
      elif [[ -x "/opt/brave-origin-bin/brave-origin" ]]; then
        LAUNCH_CMD="/opt/brave-origin-bin/brave-origin"
      else
        LAUNCH_CMD="brave-origin"
      fi
      ;;
    chromium)
      TARGET_LABEL="Chromium"
      TARGET_NAME="chromium"
      LAUNCH_CMD="chromium"
      ;;
    firefox)
      TARGET_LABEL="Firefox"
      TARGET_NAME="firefox"
      LAUNCH_CMD="firefox"
      ;;
    *)
      TARGET_LABEL="$target"
      TARGET_NAME="$target"
      LAUNCH_CMD="$target"
      ;;
  esac
}

# Determine if process command line matches target browser
benchmark_matches_target() {
  local target="$1"
  local args="$2"

  case "$target" in
    mise)
      [[ "$args" == (*MiseBrowser*|*mise-browser*) ]]
      ;;
    brave|brave-origin)
      [[ "$args" == (*brave-origin*|*brave-browser*|*brave*) ]]
      ;;
    chromium)
      [[ "$args" == *chromium* ]]
      ;;
    firefox)
      [[ "$args" == *firefox* ]]
      ;;
    *)
      [[ "$args" == *"$target"* ]]
      ;;
  esac
}

# Scan running user processes matching target pattern
benchmark_get_pids() {
  local -a pids=()
  local pid args

  while read -r pid args; do
    [[ -z "$pid" ]] && continue
    [[ "$pid" == "$$" || "$pid" == "$PPID" ]] && continue
    [[ "$args" == *"benchmark.zsh"* ]] && continue
    [[ "$args" == *"resources.zsh"* ]] && continue

    if benchmark_matches_target "$TARGET_NAME" "$args"; then
      pids+=( "$pid" )
    fi
  done < <(ps -u "$USER" -o pid=,args=)

  print -l "${pids[@]}"
}

# Determine process role from command line arguments
benchmark_detect_role() {
  local args="$1"
  local proc_type="main"

  if [[ "$TARGET_NAME" == "firefox" ]]; then
    if [[ "$args" == *"-contentproc"* ]]; then
      proc_type="renderer"
    elif [[ "$args" == *"-gpu"* ]]; then
      proc_type="gpu"
    elif [[ "$args" == *"-socket"* ]]; then
      proc_type="util:socket"
    fi
    print "$proc_type"
    return
  fi

  if [[ "$args" =~ "type=([^ ]+)" ]]; then
    proc_type="$match[1]"
  fi
  if [[ "$proc_type" == "gpu-process" ]]; then
    proc_type="gpu"
  elif [[ "$proc_type" == "utility" && "$args" =~ "utility-sub-type=([^ ]+)" ]]; then
    local sub="${match[1]##*.}"
    proc_type="util:${sub}"
  fi

  print "$proc_type"
}

# Collect process resource metrics from procfs
benchmark_read_proc() {
  local pid="$1"
  local -i rss=0 pss=0 uss=0 shared=0 utime=0 stime=0
  local k v rest stat_line stat_rest
  local -a fields

  if [[ -r "/proc/$pid/smaps_rollup" ]]; then
    while read -r k v rest; do
      case "$k" in
        Rss:) rss="${v% kB}" ;;
        Pss:) pss="${v% kB}" ;;
        Private_Clean:|Private_Dirty:) (( uss += ${v% kB} )) ;;
        Shared_Clean:|Shared_Dirty:) (( shared += ${v% kB} )) ;;
      esac
    done < "/proc/$pid/smaps_rollup"
  fi

  if [[ -r "/proc/$pid/stat" ]]; then
    stat_line="$(< /proc/$pid/stat)"
    stat_rest="${stat_line##*) }"
    fields=( ${(z)stat_rest} )
    utime=${fields[12]}
    stime=${fields[13]}
  fi

  print "${rss}|${pss}|${uss}|${shared}|${utime}|${stime}"
}

# Sample active target across specified sampling interval
benchmark_sample() {
  local target="$1"
  local -i duration="${2:-5}"
  local -i tab_count="${3:-10}"
  local label_suffix="${4:-}"

  benchmark_resolve_target "$target"
  local -a initial_pids=( ${(f)"$(benchmark_get_pids)"} )

  if (( ${#initial_pids} == 0 )); then
    print "Error: No active processes found for target: $TARGET_LABEL"
    return 1
  fi

  local -i clk_tck=$(getconf CLK_TCK 2>/dev/null || echo 100)
  local -A start_ticks
  local pid res rss pss uss shared utime stime

  print "Monitoring $TARGET_LABEL (${#initial_pids} processes) over ${duration}s interval..."

  typeset -F t_start=$EPOCHREALTIME
  for pid in "${initial_pids[@]}"; do
    res="$(benchmark_read_proc "$pid")"
    IFS="|" read -r rss pss uss shared utime stime <<< "$res"
    start_ticks[$pid]=$(( utime + stime ))
  done

  sleep "$duration"

  typeset -F t_end=$EPOCHREALTIME
  typeset -F dt=$(( t_end - t_start ))
  (( dt <= 0.0 )) && dt=1.0

  local -a current_pids=( ${(f)"$(benchmark_get_pids)"} )
  local -F total_rss=0.0 total_pss=0.0 total_uss=0.0 total_shared=0.0
  local -F main_pss=0.0 gpu_pss=0.0 renderer_pss=0.0 util_pss=0.0
  local -i total_dticks=0
  local -a process_rows=()
  local role args

  for pid in "${current_pids[@]}"; do
    res="$(benchmark_read_proc "$pid")"
    IFS="|" read -r rss pss uss shared utime stime <<< "$res"

    local -i initial_tick=${start_ticks[$pid]:-$(( utime + stime ))}
    local -i pid_dtick=$(( (utime + stime) - initial_tick ))
    (( pid_dtick < 0 )) && pid_dtick=0
    (( total_dticks += pid_dtick ))

    typeset -F pid_cpu=$(( (pid_dtick * 100.0) / (clk_tck * dt) ))

    args="$(ps -q "$pid" -o args= 2>/dev/null || true)"
    role="$(benchmark_detect_role "$args")"

    (( total_rss += rss ))
    (( total_pss += pss ))
    (( total_uss += uss ))
    (( total_shared += shared ))

    case "$role" in
      main) (( main_pss += pss )) ;;
      gpu) (( gpu_pss += pss )) ;;
      renderer) (( renderer_pss += pss )) ;;
      util*) (( util_pss += pss )) ;;
      *) (( renderer_pss += pss )) ;;
    esac

    process_rows+=( "$(printf "%-7s  %5.1f%%  %9.1f MB  %9.1f MB  %9.1f MB  %s" "$pid" "$pid_cpu" "$(( rss / 1024.0 ))" "$(( pss / 1024.0 ))" "$(( uss / 1024.0 ))" "$role")" )
  done

  typeset -F avg_cpu=$(( (total_dticks * 100.0) / (clk_tck * dt) ))
  typeset -F pss_mb=$(( total_pss / 1024.0 ))
  typeset -F rss_mb=$(( total_rss / 1024.0 ))
  typeset -F uss_mb=$(( total_uss / 1024.0 ))
  typeset -F shared_mb=$(( total_shared / 1024.0 ))

  print ""
  print "========================================================================"
  printf "Benchmark Result: %s (%d tabs)%s\n" "$TARGET_LABEL" "$tab_count" "$label_suffix"
  print "========================================================================"
  printf "%-7s  %6s  %12s  %12s  %12s  %s\n" "PID" "CPU" "RSS (Heap)" "PSS (Real)" "USS (Priv)" "ROLE"
  print "========================================================================"
  for row in "${process_rows[@]}"; do
    print "$row"
  done
  print "========================================================================"
  printf "Totals:  %5.1f%%  %9.1f MB  %9.1f MB  %9.1f MB  (%d processes)\n" \
    "$avg_cpu" "$rss_mb" "$pss_mb" "$uss_mb" "${#current_pids}"
  print "========================================================================"
  print ""

  local timestamp="$(date +%Y%m%d-%H%M%S)"
  local out_file="${RESULTS_DIR}/${TARGET_NAME}-${timestamp}.json"
  local latest_file="${RESULTS_DIR}/latest-${TARGET_NAME}.json"

  cat <<EOF > "$out_file"
{
  "target": "$TARGET_NAME",
  "label": "$TARGET_LABEL",
  "timestamp": "$timestamp",
  "tab_count": $tab_count,
  "sample_duration_s": $duration,
  "process_count": ${#current_pids},
  "pss_mb": $pss_mb,
  "rss_mb": $rss_mb,
  "uss_mb": $uss_mb,
  "shared_mb": $shared_mb,
  "cpu_percent": $avg_cpu,
  "roles": {
    "main_pss_mb": $(( main_pss / 1024.0 )),
    "gpu_pss_mb": $(( gpu_pss / 1024.0 )),
    "renderer_pss_mb": $(( renderer_pss / 1024.0 )),
    "utility_pss_mb": $(( util_pss / 1024.0 ))
  }
}
EOF

  cp "$out_file" "$latest_file"
  print "Result saved: $out_file"
  print "Updated link: $latest_file"
}

# Parse key metric from saved JSON result file
benchmark_extract_json_val() {
  local file="$1"
  local key="$2"
  local content="$(< "$file")"

  if [[ "$content" =~ "\"${key}\":[[:space:]]*\"([^\"]+)\"" ]]; then
    print "$match[1]"
    return
  fi
  if [[ "$content" =~ "\"${key}\":[[:space:]]*([0-9.]+)" ]]; then
    print "$match[1]"
    return
  fi
  print "0"
}

# Compare two JSON benchmark results side by side
benchmark_compare() {
  local file_a="${1:-${RESULTS_DIR}/latest-mise.json}"
  local file_b="${2:-${RESULTS_DIR}/latest-brave.json}"

  if [[ ! -f "$file_a" || ! -f "$file_b" ]]; then
    print "Error: Cannot find result files to compare."
    print "Expected files:"
    print "  File A: $file_a"
    print "  File B: $file_b"
    print "Run measure or run first to generate benchmark snapshots."
    return 1
  fi

  local label_a="$(benchmark_extract_json_val "$file_a" "label")"
  local label_b="$(benchmark_extract_json_val "$file_b" "label")"
  local tabs_a="$(benchmark_extract_json_val "$file_a" "tab_count")"
  local tabs_b="$(benchmark_extract_json_val "$file_b" "tab_count")"
  local procs_a="$(benchmark_extract_json_val "$file_a" "process_count")"
  local procs_b="$(benchmark_extract_json_val "$file_b" "process_count")"

  typeset -F pss_a="$(benchmark_extract_json_val "$file_a" "pss_mb")"
  typeset -F pss_b="$(benchmark_extract_json_val "$file_b" "pss_mb")"
  typeset -F rss_a="$(benchmark_extract_json_val "$file_a" "rss_mb")"
  typeset -F rss_b="$(benchmark_extract_json_val "$file_b" "rss_mb")"
  typeset -F uss_a="$(benchmark_extract_json_val "$file_a" "uss_mb")"
  typeset -F uss_b="$(benchmark_extract_json_val "$file_b" "uss_mb")"
  typeset -F cpu_a="$(benchmark_extract_json_val "$file_a" "cpu_percent")"
  typeset -F cpu_b="$(benchmark_extract_json_val "$file_b" "cpu_percent")"

  typeset -F diff_pss=$(( pss_a - pss_b ))
  typeset -F pct_pss=0.0
  (( pss_b > 0 )) && pct_pss=$(( (diff_pss / pss_b) * 100.0 ))

  typeset -F diff_rss=$(( rss_a - rss_b ))
  typeset -F pct_rss=0.0
  (( rss_b > 0 )) && pct_rss=$(( (diff_rss / rss_b) * 100.0 ))

  typeset -F diff_uss=$(( uss_a - uss_b ))
  typeset -F pct_uss=0.0
  (( uss_b > 0 )) && pct_uss=$(( (diff_uss / uss_b) * 100.0 ))

  typeset -F diff_cpu=$(( cpu_a - cpu_b ))

  print ""
  print "========================================================================"
  printf "Browser Resource Comparison (%s tabs)\n" "$tabs_a"
  print "========================================================================"
  printf "%-26s  %14s  %14s  %12s\n" "METRIC" "$label_a" "$label_b" "DELTA"
  print "========================================================================"
  printf "%-26s  %11.1f MB  %11.1f MB  %+9.1f MB (%+.1f%%)\n" \
    "Real RAM (Total PSS)" "$pss_a" "$pss_b" "$diff_pss" "$pct_pss"
  printf "%-26s  %11.1f MB  %11.1f MB  %+9.1f MB (%+.1f%%)\n" \
    "Reported Heap (Total RSS)" "$rss_a" "$rss_b" "$diff_rss" "$pct_rss"
  printf "%-26s  %11.1f MB  %11.1f MB  %+9.1f MB (%+.1f%%)\n" \
    "Private Memory (USS)" "$uss_a" "$uss_b" "$diff_uss" "$pct_uss"
  printf "%-26s  %13.1f%%  %13.1f%%  %+9.1f%%\n" \
    "Settled CPU Usage" "$cpu_a" "$cpu_b" "$diff_cpu"
  printf "%-26s  %14s  %14s  %+10d procs\n" \
    "Process Count" "$procs_a" "$procs_b" "$(( procs_a - procs_b ))"
  if (( tabs_a > 0 && tabs_b > 0 )); then
    printf "%-26s  %11.1f MB  %11.1f MB  %+9.1f MB\n" \
      "RAM per Tab (PSS / Tabs)" "$(( pss_a / tabs_a ))" "$(( pss_b / tabs_b ))" "$(( (pss_a / tabs_a) - (pss_b / tabs_b) ))"
  fi
  print "========================================================================"
  print ""
}

# Generate Markdown documentation report from latest results
benchmark_report() {
  local file_mise="${RESULTS_DIR}/latest-mise.json"
  local file_brave="${RESULTS_DIR}/latest-brave.json"
  local report_file="${RESULTS_DIR}/benchmark-report.md"

  if [[ ! -f "$file_mise" || ! -f "$file_brave" ]]; then
    print "Error: Need both latest-mise.json and latest-brave.json to write report."
    return 1
  fi

  local label_a="$(benchmark_extract_json_val "$file_mise" "label")"
  local label_b="$(benchmark_extract_json_val "$file_brave" "label")"
  local tabs="$(benchmark_extract_json_val "$file_mise" "tab_count")"
  local procs_a="$(benchmark_extract_json_val "$file_mise" "process_count")"
  local procs_b="$(benchmark_extract_json_val "$file_brave" "process_count")"

  typeset -F pss_a="$(benchmark_extract_json_val "$file_mise" "pss_mb")"
  typeset -F pss_b="$(benchmark_extract_json_val "$file_brave" "pss_mb")"
  typeset -F rss_a="$(benchmark_extract_json_val "$file_mise" "rss_mb")"
  typeset -F rss_b="$(benchmark_extract_json_val "$file_brave" "rss_mb")"
  typeset -F uss_a="$(benchmark_extract_json_val "$file_mise" "uss_mb")"
  typeset -F uss_b="$(benchmark_extract_json_val "$file_brave" "uss_mb")"
  typeset -F cpu_a="$(benchmark_extract_json_val "$file_mise" "cpu_percent")"
  typeset -F cpu_b="$(benchmark_extract_json_val "$file_brave" "cpu_percent")"

  typeset -F diff_pss=$(( pss_a - pss_b ))
  typeset -F pct_pss=$(( (diff_pss / pss_b) * 100.0 ))

  cat <<EOF > "$report_file"
# Browser Resource Benchmark Report

Automated multi-process resource evaluation conducted on Linux Wayland.

## Test Configuration
* Workload: ${tabs} simultaneous tabs across standardised reference pages
* Memory Accounting: Proportional Set Size (PSS) via /proc/[pid]/smaps_rollup
* Sampling Window: Settled idle phase after document completion

## Primary Resource Metrics

| Metric | ${label_a} | ${label_b} | Variance |
| :--- | :--- | :--- | :--- |
| **Real RAM (PSS Total)** | **${pss_a} MB** | **${pss_b} MB** | **${pct_pss}%** |
| Reported RSS | ${rss_a} MB | ${rss_b} MB | $(( rss_a - rss_b )) MB |
| Private Memory (USS) | ${uss_a} MB | ${uss_b} MB | $(( uss_a - uss_b )) MB |
| Settled CPU Draw | ${cpu_a}% | ${cpu_b}% | $(( cpu_a - cpu_b ))% |
| Process Count | ${procs_a} | ${procs_b} | $(( procs_a - procs_b )) |
| Real RAM per Tab | $(( pss_a / tabs )) MB | $(( pss_b / tabs )) MB | $(( (pss_a / tabs) - (pss_b / tabs) )) MB |

## Key Insights
1. **Accurate Memory Accounting**: Traditional task managers sum resident set size (RSS), which multiplies shared system libraries across every child process. Proportional Set Size (PSS) divides shared code pages evenly, presenting genuine physical memory usage.
2. **Process Boundary Control**: Mise Browser caps renderer processes via process limits, reducing per-process OS overhead while preserving guest security.
3. **Tab Hibernation Capability**: Mise Browser detaches idle webviews when inactive, releasing guest JavaScript heap memory back to the Linux kernel.
EOF

  print "Markdown report written to: $report_file"
}

# Automated run: launch browser with URL list, settle, sample
benchmark_run() {
  local target="$1"
  local suite_size="${2:-10}"
  local settle_time="${3:-20}"
  local sample_time="${4:-5}"
  local custom_url_file="${5:-}"
  local url_file=""

  if [[ -n "$custom_url_file" && -f "$custom_url_file" ]]; then
    url_file="$custom_url_file"
  else
    url_file="${URLS_DIR}/${suite_size}-tabs-mixed.txt"
    [[ ! -f "$url_file" ]] && url_file="${URLS_DIR}/10-tabs-mixed.txt"
  fi

  local -a urls=( ${(f)"$(< "$url_file")"} )
  local -i tab_count=${#urls}

  benchmark_resolve_target "$target"
  print "Starting automated test for $TARGET_LABEL ($tab_count tabs)..."
  print "URL Suite: $url_file"

  if [[ "$TARGET_NAME" == "mise" ]]; then
    print "Launching Mise Browser..."
    ( cd "$PROJECT_ROOT" && npm start -- "${urls[@]}" >/dev/null 2>&1 ) &
  elif [[ "$TARGET_NAME" == "brave" ]]; then
    local tmp_dir="/tmp/mise_bench_brave_profile"
    rm -rf "$tmp_dir" && mkdir -p "$tmp_dir"
    print "Launching Brave Origin with isolated temporary profile..."
    "$LAUNCH_CMD" --user-data-dir="$tmp_dir" --no-first-run "${urls[@]}" >/dev/null 2>&1 &
  else
    "$LAUNCH_CMD" "${urls[@]}" >/dev/null 2>&1 &
  fi

  print "Waiting ${settle_time}s for pages to finish loading and settle..."
  sleep "$settle_time"

  benchmark_sample "$target" "$sample_time" "$tab_count"
}

# Test memory before and after tab hibernation
benchmark_hibernation() {
  local target="${1:-mise}"
  local -i dur="${2:-5}"
  local -i tabs="${3:-10}"

  benchmark_resolve_target "$target"
  print "Phase 1: Sampling active awake tabs..."
  benchmark_sample "$target" "$dur" "$tabs" " [Active Tabs]"

  local active_file="${RESULTS_DIR}/latest-${TARGET_NAME}.json"
  typeset -F active_pss="$(benchmark_extract_json_val "$active_file" "pss_mb")"

  print ""
  print "Active snapshot recorded ($active_pss MB PSS)."
  print "Now please trigger tab hibernation or wait for idle timeout."
  print "Press Enter when inactive tabs are hibernated..."
  read -r

  print "Phase 2: Sampling hibernated tabs..."
  benchmark_sample "$target" "$dur" "$tabs" " [Hibernated Tabs]"

  local sleep_file="${RESULTS_DIR}/latest-${TARGET_NAME}.json"
  typeset -F sleep_pss="$(benchmark_extract_json_val "$sleep_file" "pss_mb")"
  typeset -F reclaimed=$(( active_pss - sleep_pss ))
  typeset -F pct_saved=0.0
  (( active_pss > 0 )) && pct_saved=$(( (reclaimed / active_pss) * 100.0 ))

  print "========================================================================"
  printf "Tab Hibernation Efficiency Summary: %s\n" "$TARGET_LABEL"
  print "========================================================================"
  printf "Active Tab RAM (PSS):      %9.1f MB\n" "$active_pss"
  printf "Hibernated RAM (PSS):      %9.1f MB\n" "$sleep_pss"
  printf "Physical Memory Reclaimed: %9.1f MB (%.1f%% saved)\n" "$reclaimed" "$pct_saved"
  print "========================================================================"
  print ""
}

# CLI command dispatcher
main() {
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    measure)
      local target="mise"
      local -i dur=5
      local -i tabs=10
      while [[ $# -gt 0 ]]; do
        case "$1" in
          -d) dur="$2"; shift 2 ;;
          -t) tabs="$2"; shift 2 ;;
          -h) benchmark_help; return 0 ;;
          *) target="$1"; shift ;;
        esac
      done
      benchmark_sample "$target" "$dur" "$tabs"
      ;;
    run)
      local target="mise"
      local -i suite=10
      local -i settle=20
      local -i dur=5
      local custom_urls=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          -s) suite="$2"; shift 2 ;;
          -w) settle="$2"; shift 2 ;;
          -d) dur="$2"; shift 2 ;;
          -u) custom_urls="$2"; shift 2 ;;
          -h) benchmark_help; return 0 ;;
          *) target="$1"; shift ;;
        esac
      done
      benchmark_run "$target" "$suite" "$settle" "$dur" "$custom_urls"
      ;;
    hibernation)
      local target="mise"
      local -i dur=5
      local -i tabs=10
      while [[ $# -gt 0 ]]; do
        case "$1" in
          -d) dur="$2"; shift 2 ;;
          -t) tabs="$2"; shift 2 ;;
          -h) benchmark_help; return 0 ;;
          *) target="$1"; shift ;;
        esac
      done
      benchmark_hibernation "$target" "$dur" "$tabs"
      ;;
    compare)
      benchmark_compare "$@"
      ;;
    report)
      benchmark_report
      ;;
    help|-h)
      benchmark_help
      ;;
    *)
      print "Unknown command: $cmd"
      benchmark_help
      return 1
      ;;
  esac
}

main "$@"
