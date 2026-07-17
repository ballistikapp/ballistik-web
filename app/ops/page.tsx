import { OpsLookupForm } from "@/components/ops/ops-lookup-form";

export default function OpsHomePage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ops Console</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Look up a User by main wallet or token mint.
        </p>
      </div>
      <OpsLookupForm />
    </div>
  );
}
