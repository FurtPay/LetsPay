import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,  // client/ dir — fixes pnpm subpath export resolution
  },
};

export default nextConfig;
