/** @type {import('next').NextConfig} */
const nextConfig = {
	eslint: { ignoreDuringBuilds: true },
	output: "export",
	reactStrictMode: true,
	typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
