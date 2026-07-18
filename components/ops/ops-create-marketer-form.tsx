"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc/client";

export function OpsCreateMarketerForm() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [nickname, setNickname] = useState("");
  const [feeSharePercent, setFeeSharePercent] = useState("10");
  const [isEnabled, setIsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.ops.createMarketer.useMutation({
    onSuccess: (marketer) => {
      router.push(`/ops/marketers/${marketer.id}`);
    },
    onError: (createError) => {
      setError(createError.message || "Failed to create Marketer");
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedUserId = userId.trim();
    const trimmedNickname = nickname.trim();
    const percent = Number(feeSharePercent);

    if (!trimmedUserId) {
      setError("User id is required.");
      return;
    }
    if (!trimmedNickname) {
      setError("Nickname is required.");
      return;
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setError("Fee-share rate must be between 0 and 100%.");
      return;
    }

    createMutation.mutate({
      userId: trimmedUserId,
      nickname: trimmedNickname,
      feeShareRate: percent / 100,
      isEnabled,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Designate Marketer
        </h1>
        <p className="text-muted-foreground text-sm">
          Create a Marketer from an existing User. Referral code and
          fee-collector are set by the Marketer later.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="marketer-user-id">User id</Label>
          <Input
            id="marketer-user-id"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="Paste the User id"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="marketer-nickname">Ops nickname</Label>
          <Input
            id="marketer-nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Internal label (not the shareable code)"
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="marketer-fee-share">Fee-share rate (%)</Label>
          <Input
            id="marketer-fee-share"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={feeSharePercent}
            onChange={(event) => setFeeSharePercent(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Between 0 and 100. Applies live to future collections for this
            Marketer&apos;s Referrals.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id="marketer-enabled"
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
          />
          <Label htmlFor="marketer-enabled">Enabled</Label>
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create Marketer"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/ops/marketers")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
