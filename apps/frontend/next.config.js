const path = require("node:path");
const withPWAInit = require("next-pwa");

/** @type {import('next-pwa').PWAConfig} */
const withPWA = withPWAInit({
	dest: "public",
	register: true,
	skipWaiting: true,
	// Solution: https://github.com/shadowwalker/next-pwa/issues/424#issuecomment-1399683017
	buildExcludes: ["app-build-manifest.json"],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
	eslint: { ignoreDuringBuilds: true },
	output: "export",
	reactStrictMode: true,
	transpilePackages: ["@ryot/generated", "@ryot/graphql"],
	typescript: { ignoreBuildErrors: true },
};

module.exports = withPWA(nextConfig);
