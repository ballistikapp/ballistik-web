# 02 — Browse Users & Launches

**What to build:** Dense Ops tables for Users and Launches (server pagination, text search, limited column sort). Opening a User row goes to the existing User spine; opening a Launch row goes to the existing Launch autopsy. List payloads never include private keys.

**Blocked by:** 01 — Ops shell: sidebar + Ops Overview

**Status:** ready-for-agent

- [ ] `/ops/users` lists Users in a dense table with pagination, search, and limited sort
- [ ] User row navigates to the existing User spine
- [ ] `/ops/launches` lists Launches in a dense table with pagination, search, and limited sort
- [ ] Launch row navigates to the existing Launch autopsy
- [ ] List/read payloads omit private keys
- [ ] Non-Operator access remains not-found at page and procedure level
