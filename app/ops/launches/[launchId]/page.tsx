import { OpsLaunchAutopsy } from "@/components/ops/ops-launch-autopsy";

type OpsLaunchPageProps = {
  params: Promise<{ launchId: string }>;
};

export default async function OpsLaunchPage({ params }: OpsLaunchPageProps) {
  const { launchId } = await params;
  return <OpsLaunchAutopsy launchId={launchId} />;
}
