/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The monorepo packages are TS source; transpile them for the app build.
  transpilePackages: ['@chainscope/shared', '@chainscope/config'],
};
export default nextConfig;
