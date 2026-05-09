import type { ExpoConfig } from "expo/config";

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
	ios: { supportsTablet: true, bundleIdentifier: "io.ryot.app" },
	splash: {
		resizeMode: "contain",
		backgroundColor: "#fd7e14",
		image: "./assets/images/splash-icon.png",
	},
	web: {
		bundler: "metro",
		output: "single",
		favicon: "./assets/images/favicon.png",
	},
	android: {
		package: "io.ryot.app",
		adaptiveIcon: {
			backgroundColor: "#fd7e14",
			foregroundImage: "./assets/images/adaptive-icon.png",
		},
	},
	plugins: [
		"expo-font",
		"expo-router",
		"expo-web-browser",
		"@react-native-community/datetimepicker",
	],
};

export default config;
