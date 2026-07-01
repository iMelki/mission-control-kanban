/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
