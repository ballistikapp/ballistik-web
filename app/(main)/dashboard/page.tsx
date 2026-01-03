import { SectionCards } from "@/components/template/section-cards";
import { ChartAreaInteractive } from "@/components/template/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import data from "./data.json";

export default function Page() {
  return (
    <>
      <SectionCards />
      <ChartAreaInteractive />
      <DataTable data={data} />
    </>
  );
}
