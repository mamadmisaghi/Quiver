import LiveDesk from "./LiveDesk";
import "./live.css";
export const metadata = {
  title: "Live trading — Quiver",
  description:
    "Fund, authorize and track trading workflows across your own venue wallets.",
};
export default function LiveTradingPage() {
  return <LiveDesk />;
}
