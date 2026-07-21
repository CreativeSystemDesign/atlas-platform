import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "dev.atlas-platform.cloud",
    "magic.atlas-platform.cloud",
    "extraction-studio.magic",
    "preview.atlas-platform.cloud",
  ],
};

export default nextConfig;
