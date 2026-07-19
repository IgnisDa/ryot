// oxlint-disable-next-line import/no-unassigned-import
import "@/global.css";
import { RegistryProvider, useAtomValue } from "@effect/atom-react";
import { Lora_400Regular, Lora_500Medium, Lora_600SemiBold } from "@expo-google-fonts/lora";
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import * as DevClient from "expo-dev-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Appearance, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { themeAtom } from "@/api/atoms";
import { clearAppStorage } from "@/modules/auth/client";

void SplashScreen.preventAutoHideAsync();

if (__DEV__ && Platform.OS !== "web") {
	void DevClient.registerDevMenuItems([
		{ name: "Clear app storage", callback: () => void clearAppStorage() },
	]);
}

function App() {
	const theme = useAtomValue(themeAtom);

	useEffect(() => {
		if (Platform.OS === "web") {
			if (theme === "system") {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.dataset.theme = theme;
			}
		} else {
			Appearance.setColorScheme(theme === "system" ? "unspecified" : theme);
		}
	}, [theme]);

	return (
		<SafeAreaProvider>
			<Stack screenOptions={{ headerShown: false }} />
			{/* oxlint-disable-next-line react/style-prop-object */}
			<StatusBar style="auto" />
		</SafeAreaProvider>
	);
}

export default function RootLayout() {
	const [fontsLoaded] = useFonts({
		Lora_400Regular,
		Lora_500Medium,
		Lora_600SemiBold,
		Outfit_400Regular,
		Outfit_500Medium,
		Outfit_600SemiBold,
	});

	useEffect(() => {
		if (fontsLoaded) {
			void SplashScreen.hideAsync();
		}
	}, [fontsLoaded]);

	if (!fontsLoaded) {
		return null;
	}

	return (
		<RegistryProvider>
			<App />
		</RegistryProvider>
	);
}
