import { Dimensions, Platform } from "react-native";

import { analyticsHostname, type UmamiEnvironment } from "./payload";

const resolveScreen = () => {
	const { width, height } = Dimensions.get("window");
	return `${Math.round(width)}x${Math.round(height)}`;
};

const resolveLanguage = () =>
	Platform.OS === "web"
		? globalThis.navigator.language
		: Intl.DateTimeFormat().resolvedOptions().locale;

const resolveReferrer = () => (Platform.OS === "web" ? globalThis.document.referrer : "");

export const resolveUmamiEnvironment = (serverUrl: string): UmamiEnvironment => ({
	screen: resolveScreen(),
	language: resolveLanguage(),
	referrer: resolveReferrer(),
	hostname: analyticsHostname(serverUrl),
});
