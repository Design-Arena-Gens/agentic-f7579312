/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
    turbo: {},
  },
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
