import type { NextConfig } from "next";

// Server-only FastAPI origin. Local development defaults to http://localhost:8000.
const backendApiUrl = (process.env.BACKEND_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: `${backendApiUrl}/api/auth/:path*`,
      },
      {
        source: "/api/requests/:path*",
        destination: `${backendApiUrl}/api/requests/:path*`,
      },
      {
        source: "/api/applications/:path*",
        destination: `${backendApiUrl}/api/applications/:path*`,
      },
      {
        source: "/api/chats/:path*",
        destination: `${backendApiUrl}/api/chats/:path*`,
      },
    ];
  },
};

export default nextConfig;
