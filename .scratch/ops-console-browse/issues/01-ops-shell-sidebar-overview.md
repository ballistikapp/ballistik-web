# 01 — Ops shell: sidebar + Ops Overview

**What to build:** The Ops Console gets a sidebar (Overview, Users, Wallets, Tokens, Launches). `/ops` becomes the Ops Overview with summary tiles: new Users (7d), Launches (7d), Failed Launches (7d), total Users, and total Tokens. No revenue tiles. Non-Operators still see not-found. List sidebar targets may be stubs until later tickets.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Operator sees Ops sidebar with Overview, Users, Wallets, Tokens, Launches
- [x] `/ops` shows the five agreed Overview tiles (no revenue, no RUNNING tile)
- [x] Tile values come from the ops service seam (Operator-gated; non-Operator → not-found)
- [x] Ops Overview copy/language matches the domain glossary (not “dashboard”)
- [x] Existing not-found hiding for non-Operators and logged-out auth redirect behavior remain intact
