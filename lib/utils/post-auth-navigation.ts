import { getSafeRedirectPath } from "@/lib/utils/auth-redirect";

type NavigateOptions = {
  assign?: (url: string) => void;
};

export function navigateAfterAuth(
  redirect: string | null | undefined,
  options: NavigateOptions = {}
) {
  const destination = getSafeRedirectPath(redirect);
  const assign =
    options.assign ?? ((url: string) => window.location.assign(url));

  assign(destination);
}
