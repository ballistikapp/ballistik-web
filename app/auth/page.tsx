"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  BRAND_WORDMARK_CLASSNAME,
  SITE_BRAND_NAME,
} from "@/lib/config/site.config";
import { Spinner } from "@/components/ui/spinner";
import { useSearchParams } from "next/navigation";
import { getSafeRedirectPath } from "@/lib/utils/auth-redirect";
import { navigateAfterAuth } from "@/lib/utils/post-auth-navigation";
import { WalletAuthActions } from "@/components/auth/wallet-auth-actions";
import { AccountCreatedDialog } from "@/components/auth/account-created-dialog";

const signinFormSchema = z.object({
  privateKey: z.string().min(1, "Private key is required"),
});

export default function AuthPage() {
  const searchParams = useSearchParams();
  const initialMethod = searchParams.get("method") === "private-key";
  const postAuthRedirect = React.useMemo(
    () => getSafeRedirectPath(searchParams.get("redirect")),
    [searchParams]
  );

  const [showPrivateKeySignIn, setShowPrivateKeySignIn] =
    React.useState(initialMethod);
  const [isRedirecting, setIsRedirecting] = React.useState(false);
  const [accountCreated, setAccountCreated] = React.useState<{
    mainWalletPublicKey: string;
  } | null>(null);

  const redirectToPostAuthDestination = React.useCallback(
    (redirectPath: string) => {
      setIsRedirecting(true);
      requestAnimationFrame(() => {
        navigateAfterAuth(redirectPath);
      });
    },
    []
  );

  const signinForm = useForm({
    defaultValues: {
      privateKey: undefined as string | undefined,
    },
    onSubmit: async ({ value }) => {
      const validation = signinFormSchema.safeParse(value);
      if (!validation.success) {
        toast.error("Please fill in all required fields");
        return;
      }
      loginWithPrivateKeyMutation.mutate({
        privateKey: value.privateKey!,
      });
    },
  });

  const loginWithPrivateKeyMutation = trpc.auth.loginWithPrivateKey.useMutation(
    {
      onSuccess: () => {
        toast.success("Signed in successfully!");
        resetForms();
        redirectToPostAuthDestination(postAuthRedirect);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to sign in");
      },
    }
  );

  const handleWalletAuthSuccess = (data: {
    user: { generatedWallet?: { publicKey: string; privateKey: string } };
  }) => {
    resetForms();
    const generatedWallet = data.user.generatedWallet;
    if (generatedWallet) {
      setAccountCreated({ mainWalletPublicKey: generatedWallet.publicKey });
      return;
    }
    redirectToPostAuthDestination(postAuthRedirect);
  };

  const resetForms = () => {
    signinForm.reset();
  };

  const isLoading = loginWithPrivateKeyMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 lg:p-8">
      <div className="w-full max-w-[460px]">
        <h1
          className={`text-center text-5xl font-bold mb-12 ${BRAND_WORDMARK_CLASSNAME}`}
        >
          {SITE_BRAND_NAME}
        </h1>

        <div className="space-y-5 p-6">
          {!showPrivateKeySignIn ? (
            <>
              <WalletAuthActions
                mode="login"
                intent="register"
                onLoginSuccess={handleWalletAuthSuccess}
              />

              <p className="text-xs text-center text-muted-foreground">
                Sign in or create an account by signing a message with your
                connected wallet. We will create a Main Wallet for app actions
                if this is your first sign-in.
              </p>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                signinForm.validateAllFields("submit");
                signinForm.handleSubmit();
              }}
              className="space-y-4"
            >
              <signinForm.Field
                name="privateKey"
                validators={{
                  onChange: ({ value }) => {
                    if (!value || value.trim() === "") {
                      return { message: "Private key is required" };
                    }
                    return undefined;
                  },
                }}
              >
                {(privateKeyField) => {
                  const isInvalid =
                    (privateKeyField.state.meta.isTouched ||
                      privateKeyField.state.meta.isDirty) &&
                    privateKeyField.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="signin-private-key">
                        Private Key
                      </FieldLabel>
                      <Input
                        id="signin-private-key"
                        type="password"
                        placeholder="Enter your Solana private key"
                        value={privateKeyField.state.value || ""}
                        onBlur={privateKeyField.handleBlur}
                        onChange={(e) =>
                          privateKeyField.handleChange(
                            e.target.value || undefined
                          )
                        }
                        disabled={isLoading}
                        className="font-mono text-sm h-10"
                        aria-invalid={isInvalid}
                      />
                      {isInvalid ? (
                        <FieldError
                          errors={privateKeyField.state.meta.errors}
                        />
                      ) : (
                        <FieldDescription>
                          Your base58-encoded Solana wallet private key
                        </FieldDescription>
                      )}
                    </Field>
                  );
                }}
              </signinForm.Field>

              <Button
                type="submit"
                className="w-full h-10 text-sm"
                disabled={isLoading || isRedirecting}
              >
                {isRedirecting ? (
                  <>
                    <Spinner className="mr-2" />
                    Redirecting...
                  </>
                ) : isLoading ? (
                  "Signing in..."
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          )}

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setShowPrivateKeySignIn((prev) => {
                  if (prev) {
                    resetForms();
                  }
                  return !prev;
                });
              }}
              className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              {showPrivateKeySignIn
                ? "Sign in with wallet adapter"
                : "Sign in with private key"}
            </button>
          </div>
        </div>
      </div>

      {accountCreated ? (
        <AccountCreatedDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setAccountCreated(null);
            }
          }}
          mainWalletPublicKey={accountCreated.mainWalletPublicKey}
          onGoToAccount={() => redirectToPostAuthDestination("/account")}
          onGoToApp={() => redirectToPostAuthDestination(postAuthRedirect)}
        />
      ) : null}
    </div>
  );
}
