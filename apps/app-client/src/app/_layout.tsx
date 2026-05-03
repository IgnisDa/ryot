import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import "@/global.css";
import {
	Inter_400Regular,
	Inter_500Medium,
	Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import {
	Spectral_400Regular,
	Spectral_400Regular_Italic,
	Spectral_500Medium,
	Spectral_500Medium_Italic,
} from "@expo-google-fonts/spectral";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { Provider } from "jotai";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

const queryClient = new QueryClient();

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
	const [fontsLoaded] = useFonts({
		Spectral_400Regular,
		Spectral_400Regular_Italic,
		Spectral_500Medium,
		Spectral_500Medium_Italic,
		Inter_400Regular,
		Inter_500Medium,
		Inter_600SemiBold,
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
						<StatusBar style="auto" />
						<Stack screenOptions={{ headerShown: false }} />
					</GluestackUIProvider>
				</GestureHandlerRootView>
			</Provider>
		</QueryClientProvider>
	);
}
