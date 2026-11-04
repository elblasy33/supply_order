import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Operational app: every screen is per-user and live, nothing is prerendered.
  cacheComponents: false,
  partialPrefetching: false,
  // NEXT_OUTPUT=standalone builds the self-contained server the desktop wrapper starts.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  
  async headers() {
    return [
      // the service worker and the offline page must always be re-checked so an update is noticed
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/offline.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
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
