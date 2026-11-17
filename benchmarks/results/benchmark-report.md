# Browser Resource Benchmark Report

Automated multi-process resource evaluation conducted on Linux Wayland.

## Test Configuration
* Workload: 10 simultaneous tabs across standardised reference pages
* Memory Accounting: Proportional Set Size (PSS) via /proc/[pid]/smaps_rollup
* Sampling Window: Settled idle phase after document completion

## Primary Resource Metrics

| Metric | Mise Browser | Brave Origin | Variance |
| :--- | :--- | :--- | :--- |
| **Real RAM (PSS Total)** | **810.2480468750 MB** | **942.7275390625 MB** | **-14.0527869080%** |
| Reported RSS | 2582.9882812500 MB | 2913.0937500000 MB | -330.10546875 MB |
| Private Memory (USS) | 555.3125000000 MB | 630.6132812500 MB | -75.30078125 MB |
| Settled CPU Draw | 0.7612508910% | 0.7552125855% | 0.0060383054999999519% |
| Process Count | 18 | 21 | -3 |
| Real RAM per Tab | 81.024804687499994 MB | 94.272753906250003 MB | -13.247949218750009 MB |

## Key Insights
1. **Accurate Memory Accounting**: Traditional task managers sum resident set size (RSS), which multiplies shared system libraries across every child process. Proportional Set Size (PSS) divides shared code pages evenly, presenting genuine physical memory usage.
2. **Process Boundary Control**: Mise Browser caps renderer processes via process limits, reducing per-process OS overhead while preserving guest security.
3. **Tab Hibernation Capability**: Mise Browser detaches idle webviews when inactive, releasing guest JavaScript heap memory back to the Linux kernel.
