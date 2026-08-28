import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Never let a production build overwrite the cache used by a running dev server.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
};

export default nextConfig;
