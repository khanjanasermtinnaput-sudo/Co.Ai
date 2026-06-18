/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Aof frontend talks to the tmap-v2 backend (/v1/*). When NEXT_PUBLIC_AOF_API_BASE
  // is set we proxy /v1 to it so the browser stays same-origin (no CORS in prod).
  async rewrites() {
    const base = process.env.AOF_API_PROXY;
    if (!base) return [];
    return [{ source: "/v1/:path*", destination: `${base}/v1/:path*` }];
  },
};

export default nextConfig;
