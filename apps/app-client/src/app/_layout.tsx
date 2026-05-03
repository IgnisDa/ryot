// oxlint-disable-next-line import/no-unassigned-import
import "@/global.css";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono";
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import {
	SpaceGrotesk_400Regular,
	SpaceGrotesk_500Medium,
	SpaceGrotesk_600SemiBold,
} from "@expo-google-fonts/space-grotesk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as DevClient from "expo-dev-client";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { Provider } from "jotai";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import { clearAppStorage } from "@/lib/atoms";

export const queryClient = new QueryClient();

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

if (__DEV__ && Platform.OS !== "web") {
	DevClient.registerDevMenuItems([
		{ name: "Clear app storage", callback: () => clearAppStorage() },
	]);
}

export default function RootLayout() {
	const [fontsLoaded] = useFonts({
		Outfit_500Medium,
		Outfit_400Regular,
		Outfit_600SemiBold,
		IBMPlexMono_400Regular,
		SpaceGrotesk_500Medium,
		SpaceGrotesk_400Regular,
		SpaceGrotesk_600SemiBold,
	});

	useEffect(() => {
		if (fontsLoaded) {
			SplashScreen.hideAsync();
		}
	}, [fontsLoaded]);

	if (!fontsLoaded) {
		return null;
	}

	return (
		<QueryClientProvider client={queryClient}>
			<Provider>
				<GestureHandlerRootView style={{ flex: 1 }}>
					<GluestackUIProvider mode="system">
						{/* oxlint-disable-next-line react/style-prop-object */}
						<StatusBar style="auto" />
						<Stack screenOptions={{ headerShown: false }} />
					</GluestackUIProvider>
				</GestureHandlerRootView>
			</Provider>
		</QueryClientProvider>
	);
}
