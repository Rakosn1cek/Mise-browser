# Browser Resource Benchmark Report

Automated multi-process resource evaluation conducted on Linux Wayland.

## Test Configuration
* Workload: 10 simultaneous tabs across standardised reference pages
* Memory Accounting: Proportional Set Size (PSS) via /proc/[pid]/smaps_rollup
* Sampling Window: Settled idle phase after document completion

## Primary Resource Metrics

| Metric | Mise Browser | Brave Origin | Variance |
| :--- | :--- | :--- | :--- |
| **Real RAM (PSS Total)** | **654.4746093750 MB** | **942.7275390625 MB** | **-30.5764834211%** |
| Reported RSS | 1403.4765625000 MB | 2913.0937500000 MB | -1509.6171875 MB |
| Private Memory (USS) | 394.0039062500 MB | 630.6132812500 MB | -236.609375 MB |
| Settled CPU Draw | 1.1537418269% | 0.7552125855% | 0.3985292413999999% |
| Process Count | 10 | 21 | -11 |
| Real RAM per Tab | 65.447460937499997 MB | 94.272753906250003 MB | -28.825292968750006 MB |

## Key Insights
1. **Accurate Memory Accounting**: Traditional task managers sum resident set size (RSS), which multiplies shared system libraries across every child process. Proportional Set Size (PSS) divides shared code pages evenly, presenting genuine physical memory usage.
2. **Process Boundary Control**: Mise Browser caps renderer processes via process limits, reducing per-process OS overhead while preserving guest security.
3. **Tab Hibernation Capability**: Mise Browser detaches idle webviews when inactive, releasing guest JavaScript heap memory back to the Linux kernel.
