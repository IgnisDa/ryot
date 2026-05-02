import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
	useEffect(() => {
		SplashScreen.hideAsync();
	}, []);

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
