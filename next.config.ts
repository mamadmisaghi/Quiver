import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The strategy, leaderboard and replay pages use Next's function cache.
  cacheComponents: true,
};

export default nextConfig;
