/** @type {import('next').NextConfig} */
const nextConfig = {
	eslint: { ignoreDuringBuilds: true },
	output: "export",
	reactStrictMode: true,
	transpilePackages: ["@ryot/generated", "@ryot/graphql"],
	typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
