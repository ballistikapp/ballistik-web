import { OpsWalletDetail } from "@/components/ops/ops-wallet-detail";

type OpsWalletPageProps = {
  params: Promise<{ publicKey: string }>;
};

export default async function OpsWalletPage({ params }: OpsWalletPageProps) {
  const { publicKey } = await params;
  return <OpsWalletDetail publicKey={decodeURIComponent(publicKey)} />;
}
