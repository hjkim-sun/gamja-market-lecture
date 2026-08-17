import type { NextConfig } from "next";

// Server-only FastAPI origin. Local development defaults to http://localhost:8000.
const backendApiUrl = (process.env.BACKEND_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/auth/signup",
        destination: `${backendApiUrl}/api/auth/signup`,
      },
    ];
  },
};

export default nextConfig;
