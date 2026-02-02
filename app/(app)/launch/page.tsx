import { LaunchForm } from "./launch-form";

export default function LaunchPage() {
  return (
    <div className="flex flex-col gap-12">
      <div className="flex justify-between items-center gap-2 -m-6 px-6 py-10 border-b">
        <h1 className="text-4xl">New Token Launch</h1>
        <p className=" leading-tight font-light text-right text-muted-foreground">
          Launch a new token on pump.fun in.
          <br />
          Launch a new token on pump.fun in just a few clicks.
        </p>
      </div>

      <LaunchForm />
    </div>
  );
}
