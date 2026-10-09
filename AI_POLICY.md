# Artificial Intelligence (AI) Policy

**Effective Date:** 28 September 2026 (revised October 2026)
**Project:** Mise Browser
**Architect and Lead Maintainer:** Lukas G. (Rakosn1cek)

***

## 1. Summary

Mise is a keyboard-first, container-isolated browser designed for low-resource Linux systems. I design it, I decide what goes into it, and I test it every day.

AI tools are a real part of how Mise is built, and this policy says plainly how. It also says where AI is not used: there is no AI inside the browser itself.

***

## 2. Who Decides What

* **Sole architect and maintainer:** I am the only decision-maker for Mise. I decide what the browser does, what gets built and what ships.
* **Where the ideas come from:** Features come from my own daily use and from my own research into what users of other browsers ask for and complain about.
* **Problem-driven:** Mise exists to solve specific problems: running well on fanless and low-resource hardware, working without a mouse, cutting background process bloat, and stopping trackers from following you between sites.
* **AI proposes, I decide:** AI tools sometimes suggest designs and fixes, especially in review. Nothing is adopted unless I choose it.

***

## 3. How AI Is Used in Development

AI is used in two ways, and it is more than autocomplete.

1. **A coding assistant writes code at my direction.** I describe the feature or the fix, and the assistant writes the code in my local working copy of the project.
2. **Chat assistants help with review and drafting.** I use them to review code, find bugs, suggest fixes, and draft documentation and posts. Some of their code and suggestions have been used in the project.

The rules I follow:

1. **Review and testing before commit.** I review the changes and test them on my own machine before I commit them. Security-sensitive changes get a second review pass, sometimes by a different AI model.
2. **No AI commits.** AI tools do not commit or push to the repository. I make every commit myself.
3. **Local verification.** I run syntax checks, runtime tests, memory profiling and documentation builds on my own Linux machine. Mise is developed and tested on Linux. The Windows and macOS builds come from the release workflow and have had less testing, so reports from those platforms are especially welcome.
4. **Security review.** Code that handles untrusted input is reviewed specifically for unsafe exposure and missing validation. This covers the bridges between pages and the main process, userscripts, PDF handling and network requests. These reviews have found real bugs in AI-written code. They were fixed and the fixes were checked again.
5. **Mistakes happen.** People and AI both make mistakes. If you find a security problem, please report it as described in [SECURITY.md](SECURITY.md).

***

## 4. No AI in the Browser

* **No AI models.** Mise does not include neural networks, machine learning models or AI inference tools.
* **No AI services.** The application makes no connections to AI services such as OpenAI, Anthropic or Google Gemini.
* **No page monitoring.** No background process reads page contents, user input or text for AI training or summaries.
* **No data sent to AI vendors.** Your browsing data, search queries, open tabs and bookmarks are never shared with AI services.

***

## 5. Future AI Features

Mise will not add AI features in the near future. A browser should be a predictable, privacy-respecting tool, not an AI platform.

If users ask for an AI feature in the future, this is the process:

1. **Public discussion:** I will open a public discussion on GitHub covering the use case, the technical effects and the resource cost.
2. **Public poll:** I will run a public poll of Mise users and contributors.
3. **Strong majority:** I will not consider any AI feature without an overwhelming, clear majority in favour.
4. **Privacy rules:** If the community does vote yes, the feature must be:
   * **Opt-in:** off by default.
   * **Optional:** Mise must keep its full speed and features with it switched off.
   * **Private:** browsing data, URLs and keystrokes must never leave your machine without your clear permission for each request.

***

## 6. Open Source Verification

Mise is free and open source software under the GNU General Public Licence v3.0 (GPLv3). You can read the source code and the commit history yourself.

* **Repository:** [https://github.com/Rakosn1cek/Mise-browser](https://github.com/Rakosn1cek/Mise-browser)
* **Licence:** GNU General Public Licence v3.0 (see [LICENSE](https://github.com/Rakosn1cek/Mise-browser/blob/main/LICENSE))
