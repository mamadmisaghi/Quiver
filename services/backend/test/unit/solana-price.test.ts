import { describe, expect, it } from "vitest";
import {
  selectedPoolPrice,
  spotObservation,
  priceAtSlot,
  wrappedSol,
} from "../../src/venues/solana-price";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
describe("Solana spot observations", () => {
  it("uses an exact base or inverts a verified USDC/SOL pool", () => {
    const usdSol = {
      chainId: "solana",
      baseToken: { address: usdc },
      quoteToken: { address: wrappedSol },
      priceUsd: "1",
      priceNative: "0.01",
      liquidity: { usd: 5000 },
    };
    expect(selectedPoolPrice([usdSol], wrappedSol, 1)?.price).toBe(100);
    expect(
      selectedPoolPrice(
        [{ ...usdSol, baseToken: { address: "wrong" } }],
        wrappedSol,
        1,
      ),
    ).toBeNull();
    expect(
      selectedPoolPrice(
        [
          {
            ...usdSol,
            baseToken: { address: wrappedSol },
            quoteToken: { address: usdc },
            priceUsd: "97",
          },
        ],
        wrappedSol,
        1,
      )?.price,
    ).toBe(97);
  });
  it("binds fallback prices to the mint and a recent confirmed mainnet slot", async () => {
    const marks = await spotObservation(
      wrappedSol,
      async (url) =>
        url.includes("dexscreener")
          ? []
          : url.includes("jup.ag")
            ? { [wrappedSol]: { usdPrice: 100, blockId: 9990, decimals: 9 } }
            : { jsonrpc: "2.0", id: 1, result: 10000 },
      () => 123,
    );
    expect(marks).toEqual({
      price: 100,
      at: 123,
      source: "Jupiter spot reference",
      slot: 9990,
    });
    expect(() =>
      priceAtSlot({ usdPrice: 10, blockId: 1, decimals: 9 }, 1000),
    ).toThrow(/stale/);
    await expect(
      spotObservation(wrappedSol, async (url) =>
        url.includes("dexscreener")
          ? []
          : url.includes("jup.ag")
            ? { other: { usdPrice: 100, blockId: 9990, decimals: 9 } }
            : { jsonrpc: "2.0", id: 1, result: 10000 },
      ),
    ).rejects.toThrow();
  });
});
