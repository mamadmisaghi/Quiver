import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import MarketsTable from "./MarketsTable";
export const metadata = { title: "Markets — Quiver" };
export default function Markets() {
  return (<Wrap><PageHeader title="Markets" sub="Markets your strategy can watch across four venues." /><MarketsTable /><p className="mt-6 text-[12px] text-muted">Polymarket is watch-only: odds can trigger trades elsewhere. Stock tokens are not available to US persons.</p></Wrap>);
}
