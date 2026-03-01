import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const reshapedRequire = createRequire(require.resolve("reshaped/config/postcss"));
const { config } = require("reshaped/config/postcss");

const getDefault = (module) => module?.default ?? module;

const postcssGlobalData = getDefault(
	reshapedRequire("@csstools/postcss-global-data"),
);
const postcssCustomMedia = getDefault(reshapedRequire("postcss-custom-media"));
const cssnano = getDefault(reshapedRequire("cssnano"));

export default {
	plugins: [
		postcssGlobalData(config.plugins["@csstools/postcss-global-data"]),
		postcssCustomMedia(config.plugins["postcss-custom-media"]),
		cssnano(config.plugins.cssnano),
	],
};
