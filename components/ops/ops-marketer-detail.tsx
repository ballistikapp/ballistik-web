"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

type OpsMarketerDetailProps = {
  marketerId: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function OpsMarketerDetail({ marketerId }: OpsMarketerDetailProps) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.ops.getMarketer.useQuery(
    { marketerId },
    { retry: false }
  );

  const [nickname, setNickname] = useState("");
  const [feeSharePercent, setFeeSharePercent] = useState("0");
  const [isEnabled, setIsEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setNickname(data.nickname);
    setFeeSharePercent(String(Number((data.feeShareRate * 100).toFixed(4))));
    setIsEnabled(data.isEnabled);
  }, [data]);

  const updateMutation = trpc.ops.updateMarketer.useMutation({
    onSuccess: async () => {
      setFormError(null);
      setSavedMessage("Saved");
      await utils.ops.getMarketer.invalidate({ marketerId });
      await utils.ops.listMarketers.invalidate();
    },
    onError: (updateError) => {
      setSavedMessage(null);
      setFormError(updateError.message || "Failed to update Marketer");
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSavedMessage(null);

    const trimmedNickname = nickname.trim();
    const percent = Number(feeSharePercent);

    if (!trimmedNickname) {
      setFormError("Nickname is required.");
      return;
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setFormError("Fee-share rate must be between 0 and 100%.");
      return;
    }

    updateMutation.mutate({
      marketerId,
      nickname: trimmedNickname,
      feeShareRate: percent / 100,
      isEnabled,
    });
  }

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading Marketer…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-destructive text-sm">{error?.message ?? "Not found"}</p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Marketer</h1>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium",
              data.isEnabled
                ? "bg-muted text-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {data.isEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">id</dt>
            <dd className="font-mono break-all">{data.id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">user</dt>
            <dd>
              <Link
                href={`/ops/users/${data.userId}`}
                className="underline-offset-4 hover:underline"
              >
                {data.userName}
              </Link>
              <div className="text-muted-foreground font-mono text-xs break-all">
                {data.userId}
              </div>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">main wallet</dt>
            <dd>
              <Link
                href={`/ops/wallets/${encodeURIComponent(data.mainWalletPublicKey)}`}
                className="font-mono break-all underline-offset-4 hover:underline"
              >
                {data.mainWalletPublicKey}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">created</dt>
            <dd>{formatDate(data.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">updated</dt>
            <dd>{formatDate(data.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Ops-owned fields</h2>
        <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-marketer-nickname">Ops nickname</Label>
            <Input
              id="edit-marketer-nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-marketer-fee-share">Fee-share rate (%)</Label>
            <Input
              id="edit-marketer-fee-share"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={feeSharePercent}
              onChange={(event) => setFeeSharePercent(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="edit-marketer-enabled"
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
            />
            <Label htmlFor="edit-marketer-enabled">Enabled</Label>
          </div>

          {formError ? (
            <p className="text-destructive text-sm">{formError}</p>
          ) : null}
          {savedMessage ? (
            <p className="text-muted-foreground text-sm">{savedMessage}</p>
          ) : null}

          <div>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Marketer-owned fields</h2>
        <p className="text-muted-foreground text-sm">
          Read-only in Ops. The Marketer sets these from the product surface.
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">referral code</dt>
            <dd className="font-mono break-all">
              {data.referralCode ?? "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">fee-collector public key</dt>
            <dd className="font-mono break-all">
              {data.feeCollectorPublicKey ?? "Not set"}
            </dd>
          </div>
        </dl>
      </section>

      <div>
        <Link
          href="/ops/marketers"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          Back to Marketers
        </Link>
      </div>
    </div>
  );
}
