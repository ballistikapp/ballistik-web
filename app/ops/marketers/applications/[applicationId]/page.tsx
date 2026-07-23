import { OpsMarketerApplicationDetail } from "@/components/ops/ops-marketer-application-detail";

type PageProps = {
  params: Promise<{ applicationId: string }>;
};

export default async function OpsMarketerApplicationDetailPage({
  params,
}: PageProps) {
  const { applicationId } = await params;
  return <OpsMarketerApplicationDetail applicationId={applicationId} />;
}
