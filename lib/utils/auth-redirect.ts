const AUTH_REDIRECT_FALLBACK = "/";

export function getSafeRedirectPath(
  redirect: string | null | undefined,
  fallback: string = AUTH_REDIRECT_FALLBACK
) {
  const candidate = redirect?.trim();
  if (!candidate) {
    return fallback;
  }
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function buildAuthRedirectPath(redirect: string) {
  const safeTarget = getSafeRedirectPath(redirect);
  const params = new URLSearchParams({ redirect: safeTarget });
  return `/auth?${params.toString()}`;
}
