module.exports = (api) => {
	api.cache(true);

	return {
		// unstable_transformImportMeta: jotai's ESM build (resolved by Metro 0.82+ via
		// package.json exports) contains import.meta.env.MODE which is Vite-specific and
		// breaks Metro's web bundle (plain <script>, not type="module"). This opt-in flag
		// in babel-preset-expo transforms import.meta to process.env equivalents at compile
		// time. Tracked: https://github.com/pmndrs/jotai/discussions/3041
		// Metro fix in progress: https://github.com/facebook/metro/pull/1494
		presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
		plugins: [
			["module-resolver", { root: ["./src"], alias: { "@": "./src" } }],
			"react-native-worklets/plugin",
		],
	};
};
