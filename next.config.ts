import type { NextConfig } from 'next'

// duckdb-async pulls in the native `duckdb` binding (.node files +
// node-pre-gyp). Bundlers can't trace these, so mark as server-external.
//
// Note on the build script: `package.json` runs `next build --webpack`
// (not Turbopack). Turbopack panics parsing duckdb's package.json
// `binary` section due to a missing `napi_versions` field. Dev
// (`next dev`) still uses Turbopack — only production builds opt out.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['duckdb', 'duckdb-async'],
}

export default nextConfig
