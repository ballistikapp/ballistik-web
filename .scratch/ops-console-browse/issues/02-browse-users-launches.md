# 02 — Browse Users & Launches

**What to build:** Dense Ops tables for Users and Launches (server pagination, text search, limited column sort). Opening a User row goes to the existing User spine; opening a Launch row goes to the existing Launch autopsy. List payloads never include private keys.

**Blocked by:** 01 — Ops shell: sidebar + Ops Overview

**Status:** done

- [x] `/ops/users` lists Users in a dense table with pagination, search, and limited sort
- [x] User row navigates to the existing User spine
- [x] `/ops/launches` lists Launches in a dense table with pagination, search, and limited sort
- [x] Launch row navigates to the existing Launch autopsy
- [x] List/read payloads omit private keys
- [x] Non-Operator access remains not-found at page and procedure level
