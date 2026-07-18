import { OpsMarketerDetail } from "@/components/ops/ops-marketer-detail";

type OpsMarketerPageProps = {
  params: Promise<{ marketerId: string }>;
};

export default async function OpsMarketerPage({ params }: OpsMarketerPageProps) {
  const { marketerId } = await params;
  return <OpsMarketerDetail marketerId={marketerId} />;
}
