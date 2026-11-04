/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  outputFileTracingIncludes: { "/replay/[id]": ["./data/runs/**/*"], "/results": ["./data/eval/**/*"], "/": ["./drizzle/**/*"] },
};
export default nextConfig;
