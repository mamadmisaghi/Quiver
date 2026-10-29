import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import { DEMO_LABEL } from "@/lib/api/format";
import MarketsTable from "./MarketsTable";
export const metadata = { title: "Markets — Quiver" };
export default function Markets() {
  return (<Wrap><PageHeader title="Markets" sub={`Everything a strategy can watch or trade, across four venues · ${DEMO_LABEL}`} /><MarketsTable /><p className="mt-6 text-[12px] text-muted">Polymarket is watch-only: odds can trigger trades elsewhere. Stock tokens are not available to US persons.</p></Wrap>);
}
