// oxlint-disable-next-line import/no-unassigned-import
import "@/global.css";
import { RegistryProvider } from "@effect-atom/atom-react";
import { Lora_400Regular, Lora_500Medium, Lora_600SemiBold } from "@expo-google-fonts/lora";
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

void SplashScreen.preventAutoHideAsync();

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
			<SafeAreaProvider>
				<Stack screenOptions={{ headerShown: false }} />
				{/* oxlint-disable-next-line react/style-prop-object */}
				<StatusBar style="auto" />
			</SafeAreaProvider>
		</RegistryProvider>
	);
}
