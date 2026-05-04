/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Transpile the workspace ACT packages through Next's bundler so their
  // ESM-only build is consumed correctly under both server and Edge runtimes.
  transpilePackages: [
    '@act-spec/runtime-next',
    '@act-spec/runtime-core',
    '@act-spec/adapter-framework',
    '@act-spec/adapter-programmatic',
    '@act-spec/validator',
  ],
};

export default config;
