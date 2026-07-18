"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { IconCopy } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyToClipboard } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

type MarketerSetup = {
  referralCode: string | null;
  feeCollectorPublicKey: string | null;
};

type MarketerSetupFormProps = {
  setup: MarketerSetup;
};

function isValidPublicKey(value: string) {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function buildReferralAuthUrl(code: string) {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://ballistik.app";
  return `${origin}/auth?ref=${encodeURIComponent(code)}`;
}

export function MarketerSetupForm({ setup }: MarketerSetupFormProps) {
  const utils = trpc.useUtils();
  const [referralCode, setReferralCode] = useState(setup.referralCode ?? "");
  const [feeCollectorPublicKey, setFeeCollectorPublicKey] = useState(
    setup.feeCollectorPublicKey ?? ""
  );
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setReferralCode(setup.referralCode ?? "");
    setFeeCollectorPublicKey(setup.feeCollectorPublicKey ?? "");
  }, [setup.referralCode, setup.feeCollectorPublicKey]);

  const updateMutation = trpc.marketer.updateSetup.useMutation({
    onSuccess: async () => {
      setFormError(null);
      toast.success("Referral setup saved");
      await utils.marketer.getMe.invalidate();
    },
    onError: (error) => {
      setFormError(error.message || "Failed to save referral setup");
    },
  });

  const savedCode = setup.referralCode;
  const referralAuthUrl = savedCode ? buildReferralAuthUrl(savedCode) : null;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const nextCode = referralCode.trim().toLowerCase();
    const nextCollector = feeCollectorPublicKey.trim();
    const codeChanged = nextCode !== (setup.referralCode ?? "");
    const collectorChanged =
      nextCollector !== (setup.feeCollectorPublicKey ?? "");

    if (!codeChanged && !collectorChanged) {
      setFormError("No changes to save.");
      return;
    }

    if (codeChanged) {
      if (nextCode.length < 3 || nextCode.length > 32) {
        setFormError("Referral code must be 3–32 characters.");
        return;
      }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextCode)) {
        setFormError(
          "Use lowercase letters, numbers, and hyphens only (e.g. my-code)."
        );
        return;
      }
    }

    if (collectorChanged) {
      if (!nextCollector) {
        setFormError("Fee-collector public key is required.");
        return;
      }
      if (!isValidPublicKey(nextCollector)) {
        setFormError("Invalid Solana public key.");
        return;
      }
    }

    updateMutation.mutate({
      ...(codeChanged ? { referralCode: nextCode } : {}),
      ...(collectorChanged
        ? { feeCollectorPublicKey: nextCollector }
        : {}),
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="referral-code">Referral code</Label>
        <Input
          id="referral-code"
          value={referralCode}
          onChange={(event) => setReferralCode(event.target.value)}
          placeholder="my-code"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-muted-foreground text-xs">
          Lowercase letters, numbers, and hyphens. Changing the code stops old
          links from attributing new Users.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fee-collector">Fee-collector public key</Label>
        <Input
          id="fee-collector"
          value={feeCollectorPublicKey}
          onChange={(event) => setFeeCollectorPublicKey(event.target.value)}
          placeholder="Solana wallet address"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-sm"
        />
        <p className="text-muted-foreground text-xs">
          Referral Payouts are sent to this wallet when referred Users pay
          platform fees.
        </p>
      </div>

      {referralAuthUrl ? (
        <div className="flex flex-col gap-2">
          <Label>Share link</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={referralAuthUrl}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => copyToClipboard(referralAuthUrl, "Referral link")}
            >
              <IconCopy className="size-4" />
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Set a referral code to get a copyable auth link.
        </p>
      )}

      {formError ? (
        <p className="text-destructive text-sm">{formError}</p>
      ) : null}

      <div>
        <Button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
