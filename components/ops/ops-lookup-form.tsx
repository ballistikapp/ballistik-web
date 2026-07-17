"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LookupType = "mainWallet" | "mint";

export function OpsLookupForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [type, setType] = useState<LookupType>("mainWallet");
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
      const data = await utils.client.ops.lookupUser.query({
        type,
        publicKey: trimmed,
      });
      router.push(`/ops/users/${data.id}`);
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
        <Label htmlFor="ops-lookup-type">Lookup by</Label>
        <select
          id="ops-lookup-type"
          className="border-input bg-background h-8 rounded-lg border px-2.5 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value as LookupType)}
        >
          <option value="mainWallet">User main wallet public key</option>
          <option value="mint">Token mint public key</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ops-lookup-key">Public key</Label>
        <Input
          id="ops-lookup-key"
          value={publicKey}
          onChange={(event) => setPublicKey(event.target.value)}
          placeholder="Paste a public key"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div>
        <Button type="submit" disabled={isLookingUp}>
          {isLookingUp ? "Looking up…" : "Look up User"}
        </Button>
      </div>
    </form>
  );
}
