import { Match } from "effect";
import { Dimensions, Platform } from "react-native";

import { analyticsHostname, type UmamiEnvironment } from "./payload";

// Android's smallest-width breakpoint for tablet layouts, which also separates
// iPhones from iPads.
const TABLET_MIN_WIDTH = 600;

const resolveScreen = () => {
	const { width, height } = Dimensions.get("screen");
	return `${Math.round(width)}x${Math.round(height)}`;
};

const resolveLanguage = () =>
	Platform.OS === "web"
		? globalThis.navigator.language
		: Intl.DateTimeFormat().resolvedOptions().locale;

const resolveReferrer = () => (Platform.OS === "web" ? globalThis.document.referrer : "");

// Umami derives the browser, OS and device from the User-Agent header. Native
// requests carry a plain HTTP client agent that its parser cannot classify, so
// it falls back to "desktop" and then relabels anything narrower than 1920px as
// a laptop. Report the OS and device ourselves so native sessions are not filed
// as laptops; the browser stays unset because a native app does not have one.
const resolveOs = () =>
	Match.value(Platform.OS).pipe(
		Match.when("ios", () => "iOS"),
		Match.when("android", () => "Android"),
		Match.orElse(() => undefined),
	);

const resolveDevice = () => {
	if (Platform.OS === "web") {
		return undefined;
	}
	const { width, height } = Dimensions.get("screen");
	return Math.min(width, height) >= TABLET_MIN_WIDTH ? "tablet" : "mobile";
};

export const resolveUmamiEnvironment = (serverUrl: string): UmamiEnvironment => ({
	os: resolveOs(),
	screen: resolveScreen(),
	device: resolveDevice(),
	language: resolveLanguage(),
	referrer: resolveReferrer(),
	hostname: analyticsHostname(serverUrl),
});
