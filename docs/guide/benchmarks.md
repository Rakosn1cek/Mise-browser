# Benchmarking & Resource Accounting

A scientific guide and pure Zsh test harness for evaluating Mise Browser memory, CPU, and process scaling against conventional browsers.

***

## 1. The Myth of the "Heavy Electron App"

A common assumption in Linux communities is that any application built on Electron must inherently consume excessive memory and CPU compared to C++ browsers like Brave or Chromium.

In reality, modern web browsers (whether Brave, Chrome, Chromium, or Mise) share the exact same underlying rendering engine: Chromium's Blink layout engine and the V8 JavaScript runtime. When you open ten web tabs, 90% of memory and CPU consumption is driven by guest web assets:
* Heavy JavaScript heaps (frameworks, single-page state, closures).
* Document Object Model (DOM) node trees and CSS style recalculations.
* Decoded image surfaces and GPU compositor texture tiles.

Where browsers differ is in the **overhead of their interface shell** and their **process scheduling architecture**:
* Many conventional browsers keep dozens of separate renderer processes alive in the background.
* Mise Browser is engineered with a pure vanilla interface (zero UI framework overhead), caps renderer processes via engine limits, and incorporates True Tab Hibernation to detach dormant tabs completely from memory.

To prove or disprove efficiency claims objectively, benchmarking must be conducted scientifically.

***

## 2. PSS vs RSS: Why Most Benchmarks Are Flawed

The single most common mistake in browser benchmarking on Linux is using Resident Set Size (RSS) from tools like `top`, `ps aux`, or `btop` to measure total memory.

### The Multi-Process Multiplication Error

Modern browsers run as a multi-process tree:
1. Browser coordinator (Main process)
2. GPU process (Compositor and hardware rasteriser)
3. Network and audio utilities
4. Guest renderer processes (Web tabs)

All of these processes map the exact same shared system libraries into memory:
* `libc.so`, `libglib-2.0.so`, `libgtk-3.so`, `libvulkan.so`
* Graphics drivers (Mesa, Intel, AMD, or NVIDIA userspace drivers)
* Chromium and Electron shared engine binaries

When a tool sums the RSS of ten processes, a 60 MB shared library is counted ten times (600 MB), even though the Linux kernel only holds that library in physical RAM once.

### The True Metrics: PSS and USS

To measure physical memory accurately on Linux, inspect `/proc/[pid]/smaps_rollup`:
* **Proportional Set Size (PSS)**: Divides each shared memory page equally among the processes sharing it, whilst counting private memory in full. Summing PSS across the process tree reveals the **exact physical RAM** occupied by the browser.
* **Unique Set Size (USS)**: The private clean and dirty memory held exclusively by a process. This represents memory that would be immediately reclaimed by the OS if the process exited.

***

## 3. Principles of a Fair Comparison

To ensure benchmarks are impartial and unassailable:
1. **Identical URL Workloads**: Open the exact same set of pages in both browsers.
2. **Settling Time**: Allow 20 to 30 seconds after opening tabs before taking measurements. This permits network requests to complete, layout passes to finish, and V8 garbage collection to stabilise.
3. **Clean Profiles**: Test against clean browser profiles to eliminate lingering cache entries, session cookies, or third-party extensions.
4. **Ad-Blocking Parity**: Mise Browser has built-in ad-blocking via Ghostery. When testing against Brave, Brave Shields provides equivalent blocking. When testing against stock Chromium or Firefox, ad-blocking parity must be maintained or ad-free reference pages should be selected.

***

## 4. Using the Benchmark Suite

Mise Browser provides a pure Zsh benchmark harness located at `scripts/benchmark.zsh` (or executable via `npm run benchmark`).

### Standard URL Suites

Pre-configured URL suites are provided under `benchmarks/urls/`:
* **Light Suite (5 tabs)**: Reference documentation and static articles (`benchmarks/urls/5-tabs-light.txt`).
* **Mixed Suite (10 tabs)**: Everyday workload combining documentation, search, and dynamic applications (`benchmarks/urls/10-tabs-mixed.txt`).
* **Heavy Suite (15 tabs)**: Intensive suite including rich media, discussion forums, and complex single-page apps (`benchmarks/urls/15-tabs-heavy.txt`).

### Interactive Snapshot Mode (`measure`)

Open your desired tabs in Mise Browser, then sample resources across a settled sampling interval:

```zsh
# Sample Mise Browser over 5 seconds across 10 open tabs
./scripts/benchmark.zsh measure mise -d 5 -t 10
```

Next, open the exact same tabs in Brave Origin and run:

```zsh
# Sample Brave Origin over 5 seconds across 10 open tabs
./scripts/benchmark.zsh measure brave -d 5 -t 10
```

### Side-by-Side Comparison (`compare`)

To compare the two latest snapshots side by side:

```zsh
./scripts/benchmark.zsh compare
```

The tool produces a clear delta comparison table:

```
========================================================================
Browser Resource Comparison (10 tabs)
========================================================================
METRIC                        Mise Browser    Brave Origin         DELTA
========================================================================
Real RAM (Total PSS)              412.5 MB        685.2 MB     -272.7 MB (-39.8%)
Reported Heap (Total RSS)         840.2 MB       1420.6 MB     -580.4 MB (-40.9%)
Private Memory (USS)              310.4 MB        520.1 MB     -209.7 MB (-40.3%)
Settled CPU Usage                     0.3%            0.7%       -0.4%
Process Count                            6              13          -7 procs
RAM per Tab (PSS / Tabs)           41.3 MB         68.5 MB      -27.2 MB
========================================================================
```

### Testing True Tab Hibernation (`hibernation`)

To verify how much memory Mise Browser reclaims when idle background tabs sleep:

```zsh
./scripts/benchmark.zsh hibernation mise -d 5 -t 10
```

This measures active tabs, pauses whilst you trigger tab sleep or let the inactivity timer expire, and measures the hibernated state to calculate genuine memory savings.

### Generating Markdown Reports (`report`)

To export findings into a formatted Markdown report suitable for sharing:

```zsh
./scripts/benchmark.zsh report
```

The report is written directly to `benchmarks/results/benchmark-report.md`.
