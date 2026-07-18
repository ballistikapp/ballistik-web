"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { WalletAdapterButton } from "@/components/auth/wallet-adapter-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type WalletAuthActionsProps = {
  mode: "login" | "link";
  intent?: "login" | "register";
  accountName?: string;
  /** From `/auth?ref=` — only applied on brand-new register (server-side). */
  referralCode?: string;
  onLoginSuccess?: (data: {
    user: {
      generatedWallet?: {
        publicKey: string;
        privateKey: string;
      };
    };
  }) => void;
  onLinkSuccess?: () => void;
};

export function WalletAuthActions({
  mode,
  intent = "login",
  accountName,
  referralCode,
  onLoginSuccess,
  onLinkSuccess,
}: WalletAuthActionsProps) {
  const { connected, publicKey, signMessage, disconnect } = useWallet();
  const utils = trpc.useUtils();
  const createChallenge = trpc.auth.createWalletChallenge.useMutation();
  const loginWithWallet = trpc.auth.loginWithWalletSignature.useMutation();
  const linkWallet = trpc.auth.linkWalletAdapter.useMutation();

  const isPending =
    createChallenge.isPending ||
    loginWithWallet.isPending ||
    linkWallet.isPending;

  const handleSign = async () => {
    if (!publicKey || !connected) {
      toast.error("Connect a wallet first");
      return;
    }
    if (!signMessage) {
      toast.error("This wallet does not support message signing");
      return;
    }

    const walletPublicKey = publicKey.toBase58();
    try {
      const challenge = await createChallenge.mutateAsync({
        publicKey: walletPublicKey,
        purpose: mode === "link" ? "WALLET_LINK" : "WALLET_LOGIN",
      });
      const signature = await signMessage(
        new TextEncoder().encode(challenge.message)
      );
      const signatureBase58 = bs58.encode(signature);

      if (mode === "link") {
        await linkWallet.mutateAsync({
          publicKey: walletPublicKey,
          nonce: challenge.nonce,
          signature: signatureBase58,
        });
        await utils.auth.me.invalidate();
        toast.success("Wallet login linked");
        onLinkSuccess?.();
        return;
      }

      const result = await loginWithWallet.mutateAsync({
        publicKey: walletPublicKey,
        nonce: challenge.nonce,
        signature: signatureBase58,
        intent,
        accountName,
        ...(referralCode ? { referralCode } : {}),
      });
      toast.success("Signed in successfully!");
      onLoginSuccess?.(result);
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Wallet signature failed";
      const isUnauthorized = /not been authorized|unauthorized/i.test(
        rawMessage
      );
      if (isUnauthorized) {
        try {
          await disconnect();
        } catch {
          // Best-effort cleanup.
        }
        toast.error(
          "Wallet authorization expired. Please reconnect your wallet and try again."
        );
        return;
      }
      const isUserRejection = /reject|denied|cancel/i.test(rawMessage);
      toast.error(
        isUserRejection ? "Signature request was rejected" : rawMessage
      );
    }
  };

  return (
    <div className="space-y-2">
      <WalletAdapterButton size="default" />
      <Button
        type="button"
        className="w-full h-10 text-sm"
        disabled={!connected || isPending}
        onClick={handleSign}
      >
        {isPending ? (
          <>
            <Spinner className="mr-2" />
            {mode === "link" ? "Linking..." : "Signing..."}
          </>
        ) : mode === "link" ? (
          "Link Wallet to Your Account"
        ) : (
          "Sign In"
        )}
      </Button>
    </div>
  );
}
