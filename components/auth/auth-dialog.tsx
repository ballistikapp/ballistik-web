"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { useForm } from "@tanstack/react-form";
import * as z from "zod";
import {
  Field,
  FieldError,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";

type WalletMode = "connect" | "generate";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const registerFormSchema = z
  .object({
    accountName: z
      .string()
      .min(1, "Account name is required")
      .max(100, "Account name is too long"),
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Enter Your Private Key
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm text-amber-900 dark:text-amber-200">
                <p className="font-semibold">Security Warning</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Never share your private key with anyone</li>
                  <li>Make sure you&apos;re on the correct website</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label htmlFor="private-key-input">Private Key</Label>
            <div className="relative">
              <Input
                id="private-key-input"
                type={showKey ? "text" : "password"}
                placeholder="Enter your Solana wallet private key (base58)"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="pr-10 font-mono text-sm"
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
            <p className="text-xs text-muted-foreground">
              Base58-encoded private key from your Solana wallet
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} className="flex-1">
              Confirm
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicKey: string;
  privateKey: string;
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Your New Wallet Keys</DialogTitle>
          <DialogDescription className="pt-2">
            Save these keys securely. You&apos;ll need them to access your
            wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          <div className="rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-4">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm text-red-900 dark:text-red-200">
                <p className="font-semibold">Important: Save Your Keys</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Copy and store these keys in a secure location</li>
                  <li>You cannot recover them if lost</li>
                  <li>
                    Transfer funds to this wallet address to start using it
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <Label>Public Key (Wallet Address)</Label>
              <div className="flex gap-2">
                <Input
                  value={publicKey}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => copyToClipboard(publicKey, "public")}
                >
                  {copiedPublic ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this address to receive funds
              </p>
            </div>

            <div className="space-y-3">
              <Label>Private Key</Label>
              <div className="flex gap-2">
                <Input
                  value={privateKey}
                  readOnly
                  type="password"
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => copyToClipboard(privateKey, "private")}
                >
                  {copiedPrivate ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Keep this secret! Never share your private key
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            I&apos;ve Saved My Keys
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const [view, setView] = React.useState<"register" | "signin">("register");
  const [privateKeyDialogOpen, setPrivateKeyDialogOpen] = React.useState(false);
  const [generatedWallet, setGeneratedWallet] = React.useState<{
    publicKey: string;
    privateKey: string;
  } | null>(null);
  const [showKeysDialog, setShowKeysDialog] = React.useState(false);

  const registerForm = useForm({
    defaultValues: {
      accountName: "",
      walletMode: "connect" as WalletMode,
      privateKey: undefined as string | undefined,
    },
    onSubmit: async ({ value }) => {
      const validation = registerFormSchema.safeParse(value);
      if (!validation.success) {
        const errors = validation.error.flatten();
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
        const errors = validation.error.flatten();
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
        onOpenChange(false);
        resetForms();
        window.location.reload();
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
        onOpenChange(false);
        resetForms();
        window.location.reload();
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px] max-h-[90vh] p-5 overflow-y-auto">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-2xl">
              {view === "register" ? (
                <>
                  <span>Register</span>
                  <button
                    type="button"
                    onClick={() => setView("signin")}
                    className="text-muted-foreground group font-light opacity-60 hover:opacity-100 ml-4 transition-opacity cursor-pointer"
                  >
                    or Login
                  </button>
                </>
              ) : (
                <>
                  <span>Login</span>
                  <button
                    type="button"
                    onClick={() => setView("register")}
                    className="text-muted-foreground group font-light opacity-60 hover:opacity-100 ml-4 transition-opacity cursor-pointer"
                  >
                    or Register
                  </button>
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {view === "register" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                registerForm.validateAllFields("submit");
                registerForm.handleSubmit();
              }}
              className="space-y-8 pt-6"
            >
              <registerForm.Field
                name="accountName"
                validators={{
                  onChange: z
                    .string()
                    .min(1, "Account name is required")
                    .max(100, "Account name is too long"),
                }}
              >
                {(field) => {
                  const isInvalid =
                    (field.state.meta.isTouched || field.state.meta.isDirty) &&
                    field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor={field.name}>Account Name</FieldLabel>
                      <Input
                        id={field.name}
                        type="text"
                        placeholder="e.g., My Main Wallet"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={isLoading}
                        className="text-base"
                        aria-invalid={isInvalid}
                      />
                      {isInvalid ? (
                        <FieldError errors={field.state.meta.errors} />
                      ) : (
                        <FieldDescription>
                          Give your account a memorable name for easy
                          identification
                        </FieldDescription>
                      )}
                    </Field>
                  );
                }}
              </registerForm.Field>

              <div className="space-y-4">
                <Label>Wallet Setup</Label>
                <registerForm.Field name="walletMode">
                  {(field) => (
                    <Tabs
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v as WalletMode)}
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="connect">
                          Connect Wallet
                        </TabsTrigger>
                        <TabsTrigger value="generate">Generate New</TabsTrigger>
                      </TabsList>

                      <TabsContent value="connect" className="space-y-4">
                        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 p-4">
                          <p className="text-sm text-blue-900 dark:text-blue-200">
                            Connect your existing Solana wallet to access your
                            current funds and continue using your established
                            wallet address.
                          </p>
                        </div>

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
                                      message:
                                        "Private key is required for connecting an existing wallet",
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
                                  privateKeyField.state.meta.errors.length > 0;
                                return (
                                  <div className="space-y-3">
                                    {!privateKeyField.state.value ? (
                                      <>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          onClick={() =>
                                            setPrivateKeyDialogOpen(true)
                                          }
                                          className="w-full h-auto py-4"
                                          disabled={isLoading}
                                        >
                                          <Key className="mr-2 h-4 w-4" />
                                          Enter Your Wallet&apos;s Private Key
                                        </Button>
                                        {isInvalid && (
                                          <FieldError
                                            errors={
                                              privateKeyField.state.meta.errors
                                            }
                                          />
                                        )}
                                      </>
                                    ) : (
                                      <div className="flex gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          onClick={() =>
                                            setPrivateKeyDialogOpen(true)
                                          }
                                          className="flex-1"
                                          disabled={isLoading}
                                        >
                                          <Edit2 className="mr-2 h-4 w-4" />
                                          Edit Key
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          onClick={copyKey}
                                          className="flex-1"
                                          disabled={isLoading}
                                        >
                                          <Copy className="mr-2 h-4 w-4" />
                                          Copy Key
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

                      <TabsContent value="generate" className="space-y-4">
                        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4">
                          <p className="text-sm text-amber-900 dark:text-amber-200">
                            We&apos;ll create a brand new Solana wallet for you
                            securely on our servers. After registration,
                            you&apos;ll receive your wallet keys.
                            <br />
                            <br />
                            Remember to transfer SOL to your new wallet address
                            to start making transactions.
                          </p>
                        </div>
                      </TabsContent>
                    </Tabs>
                  )}
                </registerForm.Field>
              </div>

              <div className="space-y-4 pt-4">
                <Button
                  type="submit"
                  className="w-full h-11 text-base"
                  disabled={isLoading}
                >
                  {isLoading ? "Creating Account..." : "Create Account"}
                </Button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setView("signin")}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Already have an account?{" "}
                    <span className="text-primary font-medium hover:underline">
                      Sign in
                    </span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                signinForm.validateAllFields("submit");
                signinForm.handleSubmit();
              }}
              className="space-y-8 pt-6"
            >
              <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground mb-6">
                Sign in using your wallet&apos;s private key.
              </div>

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
                        className="font-mono text-sm"
                        aria-invalid={isInvalid}
                      />
                      {isInvalid && (
                        <FieldError
                          errors={privateKeyField.state.meta.errors}
                        />
                      )}
                    </Field>
                  );
                }}
              </signinForm.Field>

              <div className="space-y-4 pt-4">
                <Button
                  type="submit"
                  className="w-full h-11 text-base"
                  disabled={isLoading}
                >
                  {isLoading ? "Signing In..." : "Sign In"}
                </Button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setView("register")}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Don&apos;t have an account?{" "}
                    <span className="text-primary font-medium hover:underline">
                      Create one
                    </span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <PrivateKeyDialog
        open={privateKeyDialogOpen}
        onOpenChange={setPrivateKeyDialogOpen}
        onSubmit={(key) => registerForm.setFieldValue("privateKey", key)}
        currentKey={registerForm.getFieldValue("privateKey") || ""}
      />

      <WalletKeysDialog
        open={showKeysDialog}
        onOpenChange={(open) => {
          setShowKeysDialog(open);
          if (!open) {
            onOpenChange(false);
            resetForms();
            window.location.reload();
          }
        }}
        publicKey={generatedWallet?.publicKey || ""}
        privateKey={generatedWallet?.privateKey || ""}
      />
    </>
  );
}
