# Terminal Security & Oversight

Mise includes an air-gapped terminal handshake designed to protect users from malicious web scripts, hidden pastejacking commands, and unverified remote code execution.

***

## The Risk of Web Terminal Execution

Many developer documentation sites and tutorials feature one-click terminal commands (such as `curl | bash` or complex setup one-liners). Malicious websites frequently employ pastejacking techniques, injecting invisible newlines or hidden payloads into the system clipboard that execute immediately upon pasting into a terminal window.

***

## How Oversight Protects You

When you select a script or run command within Mise:

1. **Script Extension Inspection**:
   Mise's parsing algorithm scans commands for executable script extensions:
   ```text
   .sh, .bash, .zsh, .ksh, .fish, .py, .rb, .pl, .lua, .c, .rs, .go, .js, .ts
   ```

2. **Air-Gapped Handshake**:
   - Rather than executing the script directly in a background shell or passing it uninspected to a terminal child process, Mise applies the **Oversight** security protocol.
   - The verified command is placed safely onto your system clipboard.
   - Mise spawns a fresh, unmanaged, empty terminal instance.

3. **Manual Verification**:
   - Because the terminal opens empty, no code executes automatically.
   - You can review the clipboard content in your editor or terminal prompt before pressing Enter.

***

## Standalone Oversight Utility

The security scanner and pager used in this workflow is a standalone utility:

* Repository: [https://github.com/Rakosn1cek/oversight](https://github.com/Rakosn1cek/oversight)

### Installation & Integration

If you wish to enable active security scanning and paging:

1. Clone the repository:
   ```bash
   git clone https://github.com/Rakosn1cek/oversight.git
   ```
2. Place the `oversight` executable within your system `PATH` (e.g. `~/.local/bin/` or `/usr/local/bin/`).

When installed, commands prefixed with `oversight` (such as high-risk scripts, web URLs, or commands starting with `sudo`, `curl`, or `wget`) will run through the security scanner and pager prior to execution.

If you choose not to install the standalone `oversight` utility, commands in the terminal will work as normal without any checks or warnings.

***

## Terminal Emulator Detection

Mise detects your host platform and terminal emulator dynamically:

- **Linux**: Scans for installed emulators in priority order:
  `kitty` -> `alacritty` -> `foot` -> `st` -> `xterm` -> `xdg-terminal-exec`.
- **macOS**: Automatically interfaces with the native `Terminal.app`.
- **Windows**: Prefers `Windows Terminal` (`wt.exe`) with graceful fallback to `cmd.exe`.
