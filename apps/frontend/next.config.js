/** @type {import('next').NextConfig} */
const nextConfig = {
	eslint: { ignoreDuringBuilds: true },
	output: "export",
	reactStrictMode: true,
	transpilePackages: ["@trackona/generated", "@trackona/graphql"],
	typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
