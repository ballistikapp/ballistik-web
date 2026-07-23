"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MARKETER_APPLICATION_MESSAGE_MAX_LENGTH } from "@/lib/config/marketer.config";
import { trpc } from "@/lib/trpc/client";

type OpsMarketerApplicationDetailProps = {
  applicationId: string;
};

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function OpsMarketerApplicationDetail({
  applicationId,
}: OpsMarketerApplicationDetailProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [operatorNote, setOperatorNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, error: loadError } =
    trpc.ops.getMarketerApplication.useQuery(
      { applicationId },
      { retry: false }
    );

  const rejectMutation = trpc.ops.rejectMarketerApplication.useMutation({
    onSuccess: async () => {
      setError(null);
      await utils.ops.getMarketerApplication.invalidate({ applicationId });
      await utils.ops.listMarketerApplications.invalidate();
    },
    onError: (rejectError) => {
      setError(rejectError.message || "Failed to reject Application");
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-destructive text-sm">
        {loadError?.message || "Marketer Application not found"}
      </p>
    );
  }

  const isPending = data.status === "PENDING";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">
            Marketer Application
          </h1>
          <Link
            href="/ops/marketers/applications"
            className="text-sm underline-offset-4 hover:underline"
          >
            Inbox
          </Link>
        </div>
        <p className="text-muted-foreground text-sm">
          Status: {data.status} · Submitted {formatDate(data.createdAt)}
        </p>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-medium">{data.userName}</p>
        <p className="text-muted-foreground font-mono text-xs break-all">
          {data.userId}
        </p>
        <p className="text-muted-foreground font-mono text-xs break-all">
          {data.mainWalletPublicKey}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Message</Label>
        <div className="bg-muted/40 rounded-md border p-4 text-sm whitespace-pre-wrap">
          {data.message}
        </div>
      </div>

      {data.operatorNote ? (
        <div className="flex flex-col gap-2">
          <Label>Operator note</Label>
          <div className="bg-muted/40 rounded-md border p-4 text-sm whitespace-pre-wrap">
            {data.operatorNote}
          </div>
        </div>
      ) : null}

      {isPending ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-note">Reject note (optional)</Label>
            <Textarea
              id="reject-note"
              value={operatorNote}
              onChange={(event) => setOperatorNote(event.target.value)}
              rows={3}
              maxLength={MARKETER_APPLICATION_MESSAGE_MAX_LENGTH}
              placeholder="Shown to the User on their rejected Application"
            />
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() =>
                router.push(
                  `/ops/marketers/new?userId=${encodeURIComponent(data.userId)}`
                )
              }
              disabled={data.isAlreadyMarketer}
            >
              Create Marketer
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={rejectMutation.isPending}
              onClick={() => {
                setError(null);
                rejectMutation.mutate({
                  applicationId: data.id,
                  operatorNote: operatorNote.trim() || undefined,
                });
              }}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
