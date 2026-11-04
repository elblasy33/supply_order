import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Operational app: every screen is per-user and live, nothing is prerendered.
  cacheComponents: false,
  partialPrefetching: false,
  // NEXT_OUTPUT=standalone builds the self-contained server the desktop wrapper starts.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
