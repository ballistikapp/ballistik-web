"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MARKETER_APPLICATION_MESSAGE_MAX_LENGTH } from "@/lib/config/marketer.config";
import { trpc } from "@/lib/trpc/client";

type MarketerApplicationFormProps = {
  heading?: string;
  description?: string;
};

export function MarketerApplicationForm({
  heading = "Apply to become a Marketer",
  description = "Tell Operators why you want to join the referral program. Rates and designation stay Operator-owned.",
}: MarketerApplicationFormProps) {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const submitMutation = trpc.marketer.submitApplication.useMutation({
    onSuccess: async () => {
      setFormError(null);
      toast.success("Marketer Application submitted");
      await utils.marketer.getMe.invalidate();
    },
    onError: (error) => {
      setFormError(error.message || "Failed to submit Marketer Application");
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const trimmed = message.trim();
    if (!trimmed) {
      setFormError("Message is required.");
      return;
    }
    if (trimmed.length > MARKETER_APPLICATION_MESSAGE_MAX_LENGTH) {
      setFormError(
        `Message must be at most ${MARKETER_APPLICATION_MESSAGE_MAX_LENGTH} characters.`
      );
      return;
    }

    submitMutation.mutate({ message: trimmed });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{heading}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="marketer-application-message">Message</Label>
        <Textarea
          id="marketer-application-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={6}
          maxLength={MARKETER_APPLICATION_MESSAGE_MAX_LENGTH}
          placeholder="How you plan to refer Users, channels, experience…"
        />
        <p className="text-muted-foreground text-xs">
          {message.trim().length}/{MARKETER_APPLICATION_MESSAGE_MAX_LENGTH}
        </p>
      </div>

      {formError ? <p className="text-destructive text-sm">{formError}</p> : null}

      <div>
        <Button type="submit" disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Submitting…" : "Submit Application"}
        </Button>
      </div>
    </form>
  );
}
