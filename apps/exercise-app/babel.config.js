module.exports = function (api) {
	api.cache(true);
	return {
		presets: ["babel-preset-expo"],
		plugins: [
			require.resolve("expo-router/babel"),
			[
				"module-resolver",
				{
					alias: {
						"@": "./lib",
						"@ryot/generated": "../../libs/generated/src",
						"@ryot/graphql": "../../libs/graphql/src",
					},
					extensions: [".js", ".jsx", ".ts", ".tsx"],
				},
			],
		],
	};
};
