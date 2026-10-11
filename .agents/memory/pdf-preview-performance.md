---
name: PDF preview performance
description: Keep document editors responsive when working with high-resolution PDF scans.
---

For scan editors, show a pre-rendered sample image on first open and do not block the initial interface on high-resolution PDF rasterization.

**Why:** The high-resolution PDF sample kept the preview on its loading surface across captures, while a pre-rendered JPEG made the editor usable immediately.

**How to apply:** Keep the first view lightweight; do expensive PDF rendering only when the user imports a PDF, with sensible memory limits and full-resolution export when practical.
