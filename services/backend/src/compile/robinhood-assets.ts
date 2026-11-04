/** Official issuer metadata; no wallet, secrets, Node-only code, or network access here. Call through a bounded fetch of this fixed endpoint. */
export const ROBINHOOD_ISSUER_ASSETS = "https://api.robinhood.com/rhj/assets";
type AssetRow = {
  tokenSymbol?: unknown;
  tokenName?: unknown;
  status?: unknown;
  deployments?: unknown;
};
export function robinhoodIssuerCandidate(
  raw: unknown,
  requestedSymbol: string,
) {
  const symbol = requestedSymbol.trim().toUpperCase();
  if (
    !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol) ||
    raw === null ||
    typeof raw !== "object" ||
    !("assets" in raw) ||
    !Array.isArray(raw.assets)
  )
    return null;
  const rows = (raw.assets as (null | AssetRow)[]).filter(
    (x): x is AssetRow => !!x && x.tokenSymbol === symbol,
  );
  if (
    rows.length !== 1 ||
    rows[0].status !== "ASSET_STATUS_ACTIVE" ||
    !Array.isArray(rows[0].deployments)
  )
    return null;
  const nets = rows[0].deployments.filter(
    (n: unknown) =>
      !!n && typeof n === "object" && "chainId" in n && n.chainId === 4663,
  );
  if (nets.length !== 1) return null;
  const a = nets[0].contractAddress;
  if (
    typeof a !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(a) ||
    /^0x0{40}$/i.test(a)
  )
    return null;
  const address = a.toLowerCase(),
    name =
      typeof rows[0].tokenName === "string" && rows[0].tokenName.trim()
        ? rows[0].tokenName.trim().slice(0, 300)
        : symbol + " Robinhood stock token";
  return {
    id: "robinhood:token:" + address,
    symbol,
    name,
    venue: "robinhood" as const,
    kind: "token" as const,
    source: "robinhood_registry" as const,
    address,
    url: "https://robinhoodchain.blockscout.com/address/" + address,
    maxLeverage: 1,
    endDate: null,
    outcome: null,
  };
}
