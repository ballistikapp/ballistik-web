import assert from "node:assert/strict";
import test from "node:test";
import { navigateAfterAuth } from "@/lib/utils/post-auth-navigation";

test("navigates to the provided safe redirect after auth", () => {
  let assignedUrl: string | undefined;

  navigateAfterAuth("/launch?preset=free", {
    assign: (url) => {
      assignedUrl = url;
    },
  });

  assert.equal(assignedUrl, "/launch?preset=free");
});

test("falls back to the app root for unsafe redirects", () => {
  let assignedUrl: string | undefined;

  navigateAfterAuth("https://example.com/phish", {
    assign: (url) => {
      assignedUrl = url;
    },
  });

  assert.equal(assignedUrl, "/");
});
