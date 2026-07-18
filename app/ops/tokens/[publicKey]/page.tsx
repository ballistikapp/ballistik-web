import { OpsTokenDetail } from "@/components/ops/ops-token-detail";

type OpsTokenPageProps = {
  params: Promise<{ publicKey: string }>;
};

export default async function OpsTokenPage({ params }: OpsTokenPageProps) {
  const { publicKey } = await params;
  return <OpsTokenDetail publicKey={decodeURIComponent(publicKey)} />;
}
