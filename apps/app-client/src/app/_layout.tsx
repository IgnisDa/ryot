// oxlint-disable-next-line import/no-unassigned-import
import "@/global.css";
import { RegistryProvider } from "@effect/atom-react";
import { Lora_400Regular, Lora_500Medium, Lora_600SemiBold } from "@expo-google-fonts/lora";
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import { reloadAppAsync } from "expo";
import * as DevClient from "expo-dev-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnalyticsController } from "@/modules/analytics/controller";
import { clearAppStorage } from "@/modules/auth/client";
import { ThemeController } from "@/modules/theme/controller";

void SplashScreen.preventAutoHideAsync();

if (__DEV__ && Platform.OS !== "web") {
	void DevClient.registerDevMenuItems([
		{
			name: "Clear app storage",
			callback: () => {
				void clearAppStorage().then(() => reloadAppAsync("Cleared app storage"));
			},
		},
	]);
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
		<GestureHandlerRootView style={{ flex: 1 }}>
			<RegistryProvider>
				<ThemeController />
				<AnalyticsController />
				<SafeAreaProvider>
					<Stack screenOptions={{ headerShown: false }} />
					{/* oxlint-disable-next-line react/style-prop-object */}
					<StatusBar style="auto" />
				</SafeAreaProvider>
			</RegistryProvider>
		</GestureHandlerRootView>
	);
}
