import type { ExpoConfig } from "expo/config";

const MAIN_COLOR = "#fd7e14";
const isDebug = process.env.APP_VARIANT === "development";

const config: ExpoConfig = {
	slug: "ryot",
	scheme: "ryot",
	version: "1.0.0",
	orientation: "portrait",
	userInterfaceStyle: "automatic",
	icon: "./assets/images/icon.png",
	name: isDebug ? "Ryot Debug" : "Ryot",
	updates: { checkAutomatically: "NEVER" },
	experiments: { typedRoutes: true, reactCompiler: true },
	plugins: [
		"expo-font",
		"expo-router",
		"expo-web-browser",
		[
			"expo-splash-screen",
			{
				backgroundColor: MAIN_COLOR,
				resizeMode: "contain" as const,
				image: "./assets/images/splash-icon.png",
			},
		],
	],
	ios: {
		supportsTablet: true,
		bundleIdentifier: isDebug ? "io.ryot.app.dev" : "io.ryot.app",
	},
	web: {
		bundler: "metro",
		output: "single",
		favicon: "./assets/images/favicon.png",
	},
	android: {
		package: isDebug ? "io.ryot.app.dev" : "io.ryot.app",
		adaptiveIcon: {
			backgroundColor: MAIN_COLOR,
			foregroundImage: "./assets/images/adaptive-icon.png",
		},
	},
};

export default config;
