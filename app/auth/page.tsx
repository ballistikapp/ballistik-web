"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import {
  Copy,
  Edit2,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  Key,
  Wallet,
  Sparkles,
} from "lucide-react";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { useRouter, useSearchParams } from "next/navigation";

type WalletMode = "connect" | "generate";

const registerFormSchema = z
  .object({
    accountName: z.string().max(100, "Account name is too long").optional(),
    walletMode: z.enum(["connect", "generate"]),
    privateKey: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.walletMode === "connect" && !data.privateKey) {
        return false;
      }
      return true;
    },
    {
      message: "Private key is required for connecting an existing wallet",
      path: ["privateKey"],
    }
  );

const signinFormSchema = z.object({
  privateKey: z.string().min(1, "Private key is required"),
});

function PrivateKeyDialog({
  open,
  onOpenChange,
  onSubmit,
  currentKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (key: string) => void;
  currentKey?: string;
}) {
  const [privateKey, setPrivateKey] = React.useState(currentKey || "");
  const [showKey, setShowKey] = React.useState(false);

  React.useEffect(() => {
    if (open && currentKey) {
      setPrivateKey(currentKey);
    }
  }, [open, currentKey]);

  const handleSubmit = () => {
    if (!privateKey.trim()) {
      toast.error("Please enter a private key");
      return;
    }
    onSubmit(privateKey);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Enter Private Key</DialogTitle>
          <DialogDescription>
            Import your existing Solana wallet
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg bg-muted/50 border p-3">
            <div className="flex gap-2.5">
              <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Never share your private key. Make sure you&apos;re on the
                correct website.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="private-key-input" className="text-sm">
              Private Key
            </Label>
            <div className="relative">
              <Input
                id="private-key-input"
                type={showKey ? "text" : "password"}
                placeholder="Base58-encoded private key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="pr-10 font-mono text-sm h-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 h-10"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              className="flex-1 h-10"
            >
              Import Wallet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WalletKeysDialog({
  open,
  onOpenChange,
  publicKey,
  privateKey,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicKey: string;
  privateKey: string;
  onComplete: () => void;
}) {
  const [copiedPublic, setCopiedPublic] = React.useState(false);
  const [copiedPrivate, setCopiedPrivate] = React.useState(false);

  const copyToClipboard = async (text: string, type: "public" | "private") => {
    await navigator.clipboard.writeText(text);
    if (type === "public") {
      setCopiedPublic(true);
      setTimeout(() => setCopiedPublic(false), 2000);
    } else {
      setCopiedPrivate(true);
      setTimeout(() => setCopiedPrivate(false), 2000);
    }
    toast.success(`${type === "public" ? "Public" : "Private"} key copied!`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Your New Wallet</DialogTitle>
          <DialogDescription>
            Save these keys securely. You&apos;ll need them to access your
            wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
            <div className="flex gap-2.5">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-700 dark:text-red-300">
                <p className="font-medium">Store these keys securely</p>
                <p className="mt-1 opacity-90">
                  You cannot recover them if lost.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm">Wallet Address</Label>
              <div className="flex gap-2">
                <Input
                  value={publicKey}
                  readOnly
                  className="font-mono text-xs h-10"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="shrink-0 h-10 w-10"
                  onClick={() => copyToClipboard(publicKey, "public")}
                >
                  {copiedPublic ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this to receive funds
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Private Key</Label>
              <div className="flex gap-2">
                <Input
                  value={privateKey}
                  readOnly
                  type="password"
                  className="font-mono text-xs h-10"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="shrink-0 h-10 w-10"
                  onClick={() => copyToClipboard(privateKey, "private")}
                >
                  {copiedPrivate ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Keep this secret - never share it
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onComplete();
            }}
            className="w-full h-10 mt-2"
          >
            I&apos;ve Saved My Keys
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialView =
    searchParams.get("view") === "login" ? "signin" : "register";
  const defaultWalletMode = "generate" as WalletMode;

  const [view, setView] = React.useState<"register" | "signin">(initialView);
  const [privateKeyDialogOpen, setPrivateKeyDialogOpen] = React.useState(false);
  const [generatedWallet, setGeneratedWallet] = React.useState<{
    publicKey: string;
    privateKey: string;
  } | null>(null);
  const [showKeysDialog, setShowKeysDialog] = React.useState(false);

  const registerForm = useForm({
    defaultValues: {
      accountName: "",
      walletMode: defaultWalletMode,
      privateKey: undefined as string | undefined,
    },
    onSubmit: async ({ value }) => {
      const validation = registerFormSchema.safeParse(value);
      if (!validation.success) {
        toast.error("Please fix the form errors");
        return;
      }
      registerMutation.mutate({
        generateWallet: value.walletMode === "generate",
        privateKey:
          value.walletMode === "connect" ? value.privateKey : undefined,
        accountName: value.accountName,
      });
    },
  });

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

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      toast.success("Account created successfully!");
      if (data.user.generatedWallet) {
        setGeneratedWallet({
          publicKey: data.user.generatedWallet.publicKey,
          privateKey: data.user.generatedWallet.privateKey,
        });
        setShowKeysDialog(true);
      } else {
        resetForms();
        router.push("/");
      }
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create account");
    },
  });

  const loginWithPrivateKeyMutation = trpc.auth.loginWithPrivateKey.useMutation(
    {
      onSuccess: () => {
        toast.success("Signed in successfully!");
        resetForms();
        router.push("/");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to sign in");
      },
    }
  );

  const resetForms = () => {
    registerForm.reset();
    signinForm.reset();
    setGeneratedWallet(null);
  };

  const copyKey = async () => {
    const privateKey = registerForm.getFieldValue("privateKey");
    if (privateKey) {
      await navigator.clipboard.writeText(privateKey);
      toast.success("Private key copied!");
    }
  };

  const isLoading =
    registerMutation.isPending || loginWithPrivateKeyMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 lg:p-8">
      <div className="w-full max-w-[460px]">
        <h1 className="text-center text-5xl font-bold mb-12">BALLISTIK</h1>

        <div className="rounded-lg border bg-card shadow-sm">
          <div className="border-b">
            <div className="flex">
              <button
                type="button"
                onClick={() => setView("register")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${
                  view === "register"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Create Account
                {view === "register" && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setView("signin")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${
                  view === "signin"
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Sign In
                {view === "signin" && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            </div>
          </div>

          <div className="p-6">
            {view === "register" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  registerForm.validateAllFields("submit");
                  registerForm.handleSubmit();
                }}
                className="space-y-4"
              >
                <registerForm.Field name="accountName">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        Account Name{" "}
                        <span className="text-muted-foreground font-normal">
                          (optional)
                        </span>
                      </FieldLabel>
                      <Input
                        id={field.name}
                        type="text"
                        placeholder="e.g., Main Account"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={isLoading}
                        className="h-10 text-sm"
                      />
                      <FieldDescription>
                        Leave empty to use your wallet address as the name
                      </FieldDescription>
                    </Field>
                  )}
                </registerForm.Field>

                <div className="space-y-2.5">
                  <Label className="text-sm font-medium">Wallet Setup</Label>
                  <registerForm.Field name="walletMode">
                    {(field) => (
                      <Tabs
                        value={field.state.value}
                        onValueChange={(v) =>
                          field.handleChange(v as WalletMode)
                        }
                      >
                        <TabsList className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-10">
                          <TabsTrigger
                            value="generate"
                            className="text-sm gap-2"
                          >
                            <Sparkles className="w-4 h-4" />
                            Generate
                          </TabsTrigger>
                          <TabsTrigger
                            value="connect"
                            className="text-sm gap-2"
                          >
                            <Wallet className="w-4 h-4" />
                            Import
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent
                          value="generate"
                          className="mt-2.5 space-y-2.5"
                        >
                          <p className="text-sm text-muted-foreground">
                            Create a new Solana wallet. You&apos;ll receive your
                            keys after registration.
                          </p>
                          <div className="rounded-lg bg-muted/50 border p-3">
                            <p className="text-sm text-muted-foreground">
                              Remember to fund your new wallet with SOL before
                              making transactions.
                            </p>
                          </div>
                        </TabsContent>

                        <TabsContent
                          value="connect"
                          className="mt-2.5 space-y-2.5"
                        >
                          <p className="text-sm text-muted-foreground">
                            Import an existing Solana wallet using your private
                            key.
                          </p>
                          <registerForm.Subscribe
                            selector={(state) => state.values.walletMode}
                          >
                            {(walletMode) => (
                              <registerForm.Field
                                name="privateKey"
                                validators={{
                                  onChange: ({ value }) => {
                                    if (walletMode === "connect" && !value) {
                                      return {
                                        message: "Private key is required",
                                      };
                                    }
                                    return undefined;
                                  },
                                }}
                              >
                                {(privateKeyField) => {
                                  const isInvalid =
                                    (privateKeyField.state.meta.isTouched ||
                                      privateKeyField.state.meta.isDirty) &&
                                    privateKeyField.state.meta.errors.length >
                                      0;
                                  return (
                                    <div className="space-y-2">
                                      {!privateKeyField.state.value ? (
                                        <>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                              setPrivateKeyDialogOpen(true)
                                            }
                                            className="w-full h-10 text-sm"
                                            disabled={isLoading}
                                          >
                                            <Key className="mr-2 h-3.5 w-3.5" />
                                            Enter Private Key
                                          </Button>
                                          {isInvalid && (
                                            <FieldError
                                              errors={
                                                privateKeyField.state.meta
                                                  .errors
                                              }
                                            />
                                          )}
                                        </>
                                      ) : (
                                        <div className="flex gap-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              setPrivateKeyDialogOpen(true)
                                            }
                                            className="flex-1"
                                            disabled={isLoading}
                                          >
                                            <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                                            Edit
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={copyKey}
                                            className="flex-1"
                                            disabled={isLoading}
                                          >
                                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                                            Copy
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                }}
                              </registerForm.Field>
                            )}
                          </registerForm.Subscribe>
                        </TabsContent>
                      </Tabs>
                    )}
                  </registerForm.Field>
                </div>

                <Button
                  type="submit"
                  className="w-full h-10 text-sm"
                  disabled={isLoading}
                >
                  {isLoading ? "Creating account..." : "Create Account"}
                </Button>
              </form>
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
                  disabled={isLoading}
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          By continuing, you agree to our terms of service.
        </p>
      </div>

      <PrivateKeyDialog
        open={privateKeyDialogOpen}
        onOpenChange={setPrivateKeyDialogOpen}
        onSubmit={(key) => registerForm.setFieldValue("privateKey", key)}
        currentKey={registerForm.getFieldValue("privateKey") || ""}
      />

      <WalletKeysDialog
        open={showKeysDialog}
        onOpenChange={setShowKeysDialog}
        publicKey={generatedWallet?.publicKey || ""}
        privateKey={generatedWallet?.privateKey || ""}
        onComplete={() => {
          resetForms();
          router.push("/");
        }}
      />
    </div>
  );
}
