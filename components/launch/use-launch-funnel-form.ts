import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import {
  launchFunnelFormSchema,
  type LaunchFunnelFormValues,
} from "@/components/launch/launch-funnel-form-values";

export function useLaunchFunnelForm(
  defaultValues: LaunchFunnelFormValues,
  onValidSubmit: () => void
) {
  return useForm({
    defaultValues,
    validators: {
      onSubmit: launchFunnelFormSchema,
    },
    onSubmit: async ({ value }) => {
      const validation = await launchFunnelFormSchema.safeParseAsync(value);
      if (!validation.success) {
        toast.error("Validation failed", {
          description:
            validation.error.errors[0]?.message ??
            "Please check your form inputs.",
        });
        return;
      }
      onValidSubmit();
    },
  });
}

export type LaunchFunnelFormApi = ReturnType<typeof useLaunchFunnelForm>;

export type FunnelFieldState = {
  state: {
    meta: {
      isTouched: boolean;
      errors: ReadonlyArray<unknown>;
    };
  };
};
