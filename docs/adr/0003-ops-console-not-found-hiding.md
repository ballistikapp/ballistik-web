# Hide Ops Console with not-found

`/ops` is bookmark-only (no product nav). Logged-in non-Operators hitting Ops pages or Ops procedures get not-found behavior, not an explicit “forbidden” or redirect that would advertise the console.

We preferred obscurity-aligned denial over clear 403 because the URL is intentionally hidden and a distinct operator error is a free signal to anyone probing the API.
