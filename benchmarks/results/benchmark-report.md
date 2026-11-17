# Browser Resource Benchmark Report

Automated multi-process resource evaluation conducted on Linux Wayland.

## Test Configuration
* Workload: 10 simultaneous tabs across standardised reference pages
* Memory Accounting: Proportional Set Size (PSS) via /proc/[pid]/smaps_rollup
* Sampling Window: Settled idle phase after document completion

## Primary Resource Metrics

| Metric | Mise Browser | Brave Origin | Variance |
| :--- | :--- | :--- | :--- |
| **Real RAM (PSS Total)** | **978.3134765625 MB** | **942.7275390625 MB** | **3.7747849750%** |
| Reported RSS | 2667.5546875000 MB | 2913.0937500000 MB | -245.5390625 MB |
| Private Memory (USS) | 727.2265625000 MB | 630.6132812500 MB | 96.61328125 MB |
| Settled CPU Draw | 3.2470029286% | 0.7552125855% | 2.4917903430999999% |
| Process Count | 18 | 21 | -3 |
| Real RAM per Tab | 97.831347656250003 MB | 94.272753906250003 MB | 3.55859375 MB |

## Key Insights
1. **Accurate Memory Accounting**: Traditional task managers sum resident set size (RSS), which multiplies shared system libraries across every child process. Proportional Set Size (PSS) divides shared code pages evenly, presenting genuine physical memory usage.
2. **Process Boundary Control**: Mise Browser caps renderer processes via process limits, reducing per-process OS overhead while preserving guest security.
3. **Tab Hibernation Capability**: Mise Browser detaches idle webviews when inactive, releasing guest JavaScript heap memory back to the Linux kernel.
