# Third-party software

Nexo is not affiliated with the projects below. It downloads them from their own releases, pinned and verified;
it does not modify or redistribute their source.

## Engram

- **What:** persistent memory for coding agents (SQLite + full-text search, served over MCP).
- **Source:** https://github.com/Gentleman-Programming/engram — by Gentleman Programming and contributors.
- **How Nexo uses it:** `nexo memory install` (or `nexo init --memory engram`) downloads the release binary pinned in
  `nexo_bases/engram.json` (version and SHA-256 per platform) into `os/runtime/engram/<version>/`, keeps its data in
  `os/data/engram/`, and lets AIs reach it only through `nexo memory mcp`. Engram's setup, hooks, HTTP server and
  cloud sync are not used.
- **Name:** "Engram" refers to that project; Nexo's own command and module are called `memory`.
- **License:** MIT, reproduced below.

```
MIT License

Copyright (c) 2026 Alan Buscaglia

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
