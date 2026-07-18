import { OpsUserSpine } from "@/components/ops/ops-user-spine";

type OpsUserPageProps = {
  params: Promise<{ userId: string }>;
};

export default async function OpsUserPage({ params }: OpsUserPageProps) {
  const { userId } = await params;
  return <OpsUserSpine userId={userId} />;
}
