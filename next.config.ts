import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['duckdb', 'duckdb-async'],
}

export default nextConfig
