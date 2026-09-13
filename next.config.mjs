/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The research desk must feel instant on a mid-range Android phone.
  // Nothing here pulls in secrets — every provider call happens in /api routes.
  experimental: {
    optimizePackageImports: [],
  },
};

export default nextConfig;
