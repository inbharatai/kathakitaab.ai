import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @remotion/renderer + @remotion/bundler ship native binaries (puppeteer
  // chromium, ffmpeg-static, esbuild) that Next.js's bundler can't trace
  // through webpack. Marking them as server-external lets the route
  // require() them at runtime without the bundler trying to inline them.
  serverExternalPackages: [
    '@remotion/renderer',
    '@remotion/bundler',
    'puppeteer-core',
    '@remotion/compositor-darwin-arm64',
    '@remotion/compositor-darwin-x64',
    '@remotion/compositor-linux-arm64-gnu',
    '@remotion/compositor-linux-arm64-musl',
    '@remotion/compositor-linux-x64-gnu',
    '@remotion/compositor-linux-x64-musl',
    '@remotion/compositor-win32-x64-msvc',
    // pg ships an optional pg-native binding; keep it server-external so
    // the bundler never tries to inline native bits. Pure-JS path is used.
    'pg',
  ],
  // The RDS CA bundle is read at runtime via process.cwd(), which the
  // file tracer can't statically resolve — include it explicitly so it
  // lands in the Vercel deployment for strict TLS to Aurora. The global
  // route key is '/*' per Next's picomatch convention (not '/**').
  outputFileTracingIncludes: {
    '/*': ['./db/aurora/rds-ca-bundle.pem'],
  },
  // `pg` is Node-only (require('tls','net','dns','fs')). The Aurora
  // adapter is imported through bookRegistry, which client code also
  // reaches, so webpack tries to bundle `pg` for the browser and fails
  // on `tls`. On the server, `pg` is externalized via
  // serverExternalPackages and required at runtime (real modules). On
  // the client, stub the Node built-ins `pg` references — the Aurora
  // code paths are guarded by isAuroraEnabled() and never execute in
  // the browser, so the stubbed `pg` is dead client code.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        tls: false,
        net: false,
        dns: false,
        fs: false,
        child_process: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
    ];
  },
};

export default nextConfig;
