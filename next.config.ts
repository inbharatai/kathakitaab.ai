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
    // @aws-sdk/client-s3 pulls in many Node built-ins (stream, crypto,
    // http/https, zlib). Keep it server-external so the bundler never
    // tries to inline it for the browser; the storage code paths only
    // run server-side anyway (guarded by isS3Configured()).
    '@aws-sdk/client-s3',
  ],
  // The RDS CA bundle is read at runtime via process.cwd(), which the
  // file tracer can't statically resolve — include it explicitly so it
  // lands in the Vercel deployment for strict TLS to Aurora. The global
  // route key is '/*' per Next's picomatch convention (not '/**').
  outputFileTracingIncludes: {
    '/*': ['./db/aurora/rds-ca-bundle.pem'],
  },
  // `pg` + `@aws-sdk/client-s3` are Node-only (require('tls','net','dns',
  // 'fs','stream','crypto','http','https','zlib')). The Aurora + S3
  // adapters are imported through bookRegistry / imageStorage, which
  // client code also reaches, so webpack tries to bundle them for the
  // browser and fails on `tls`. On the server they're externalized via
  // serverExternalPackages and required at runtime (real modules). On
  // the client, stub the Node built-ins they reference — the Aurora +
  // S3 code paths are guarded by isAuroraEnabled()/isS3Configured() and
  // never execute in the browser, so the stubbed modules are dead
  // client code.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        tls: false,
        net: false,
        dns: false,
        fs: false,
        child_process: false,
        stream: false,
        crypto: false,
        http: false,
        https: false,
        zlib: false,
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
