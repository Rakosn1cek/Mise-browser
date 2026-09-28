# Artificial Intelligence (AI) Policy

**Effective Date:** 28 September 2026  
**Project:** Mise Browser  
**Project Architect & Lead Maintainer:** Lukas G. (Rakosn1cek)

***

## 1. Executive Summary

Mise Browser was conceived, designed, and engineered from the ground up as a lean, keyboard-first, and container-isolated browser for low-resource Linux systems. 

As artificial intelligence tools become prevalent across modern software engineering, this policy establishes clear, uncompromising boundaries regarding how AI is used in the development of Mise Browser and how AI is strictly excluded from the browser runtime.

***

## 2. Human Architecture & Engineering Rigour

Mise Browser is not the product of unvetted code generation, nor was this project "vibe-coded over a weekend". 

* **Sole Architect & Maintainer:** Lukas G. (Rakosn1cek) is the sole architect, designer, and decision-maker behind Mise Browser. Every architectural subsystem, including true DOM tab hibernation, multi-account container partitioning, memory management thresholds, and air-gapped terminal oversight, is engineered with deliberate human intent.
* **Problem-Driven Engineering:** The browser was built to solve specific technical problems: running efficiently on fanless and resource-constrained hardware without mouse reliance, eliminating background process bloat, and preventing tracker cross-contamination.
* **Full Human Ownership:** No design decision, architectural paradigm, or structural refactoring is outsourced to an automated agent. All technical direction originates with and is governed by human engineering.

***

## 3. Use of AI in the Development Process

Assisted coding tools and large language models (LLMs) are used during development strictly as auxiliary aids, comparable to advanced linters, pair-programming sounding boards, or automated code completion.

The following strict rules govern all AI assistance:

1. **Mandatory Human Code Review:** Every line of code proposed or drafted with AI assistance is manually reviewed, line by line, by Lukas G. prior to inclusion.
2. **Zero Automated Merges:** No AI tool has write or commit access to the repository. Nothing enters the codebase without explicit, manual human approval and testing.
3. **Rigorous Local Verification:** All proposed changes undergo syntax validation, runtime behaviour testing, memory profiling, and documentation builds on physical Linux environments before landing in releases.
4. **Security & Privacy Auditing:** Code drafted with assistance is audited for memory leaks, unsanitised inputs, improper IPC exposure, and compliance with Mise's strict zero-telemetry mandate.

***

## 4. Zero AI Integration in the Browser Runtime

Mise Browser is built to browse the web with minimal overhead and maximum privacy. 

* **No Embedded AI Models:** Mise Browser does not ship with bundled neural networks, on-device machine learning models, or local AI inference runtimes.
* **No Cloud AI APIs:** The application binary makes zero connections to third-party AI endpoints (such as OpenAI, Anthropic, Google Gemini, or similar services).
* **No Tracking or Automated Summarisation:** There are no background AI agents monitoring page contents, inspecting user input, or extracting text for training or inference.
* **No Telemetry to AI Vendors:** Your browsing data, search queries, active tabs, and bookmarks are never shared with or processed by artificial intelligence services.

***

## 5. Future Governance & Community Democratic Process

Mise will not integrate AI capabilities into the browser in the near future. The default stance of the project is that a web browser should remain a deterministic, privacy-respecting tool rather than an AI platform.

Should any future request arise from the community to introduce an AI-related feature, it will be handled strictly through the following democratic governance process:

1. **Formal Public Discussion:** A public discussion will be opened on GitHub outlining the specific use case, technical implications, and resource overhead.
2. **Transparent Community Poll:** A binding, public poll will be conducted among Mise Browser users and contributors.
3. **Strict Majority Threshold:** No AI integration will ever be considered without an overwhelming, demonstrable mandate from the user community.
4. **Non-Negotiable Privacy Guardrails:** In the hypothetical event that the community votes in favour of an optional AI capability in the distant future, the feature must adhere to non-negotiable principles:
   * **Strictly Opt-In:** It must be disabled by default.
   * **Fully Optional:** The browser must retain 100% of its core speed and functionality with all AI components completely disabled.
   * **Zero Third-Party Data Transmission:** Browsing data, URLs, and keystrokes must never leave the local system without explicit, affirmative per-request authorisation.

***

## 6. Transparency and Open Source Verification

Mise Browser is published as free and open source software under the GNU General Public Licence v3.0 (GPLv3). 

Users, developers, and security researchers are invited to inspect the source code, examine git commit histories, and verify that all code conforms strictly to the standards set out in this document.

* **Repository:** [https://github.com/Rakosn1cek/Mise-browser](https://github.com/Rakosn1cek/Mise-browser)
* **Licence:** GNU General Public Licence v3.0 (see [LICENSE](file:///home/rk1/arch-projects/MiseBrowser/LICENSE))
