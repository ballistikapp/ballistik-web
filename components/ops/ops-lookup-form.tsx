"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OpsLookupForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [publicKey, setPublicKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = publicKey.trim();
    if (trimmed.length < 32) {
      setError("Enter a valid public key.");
      return;
    }

    setIsLookingUp(true);
    try {
      const data = await utils.client.ops.jump.query({
        publicKey: trimmed,
      });
      if (data.kind === "user") {
        router.push(`/ops/users/${data.userId}`);
        return;
      }
      if (data.kind === "wallet") {
        router.push(`/ops/wallets/${encodeURIComponent(data.publicKey)}`);
        return;
      }
      router.push(`/ops/tokens/${encodeURIComponent(data.publicKey)}`);
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Not found";
      setError(message);
    } finally {
      setIsLookingUp(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ops-jump-key">Public key</Label>
        <Input
          id="ops-jump-key"
          value={publicKey}
          onChange={(event) => setPublicKey(event.target.value)}
          placeholder="Paste a main wallet, Wallet, or Token mint pubkey"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div>
        <Button type="submit" disabled={isLookingUp}>
          {isLookingUp ? "Jumping…" : "Jump"}
        </Button>
      </div>
    </form>
  );
}
