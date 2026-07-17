type OpsStubPageProps = {
  title: string;
  description: string;
};

export function OpsStubPage({ title, description }: OpsStubPageProps) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
