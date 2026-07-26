import { Redirect } from "expo-router";
import { useWindowDimensions } from "react-native";

import { SettingsIndexScreen } from "@/modules/settings/settings-index-screen";

const DESKTOP_BREAKPOINT = 768;

export default function SettingsIndex() {
	const dimensions = useWindowDimensions();

	if (dimensions.width >= DESKTOP_BREAKPOINT) {
		return <Redirect href="/settings/preferences" />;
	}
	return <SettingsIndexScreen />;
}
