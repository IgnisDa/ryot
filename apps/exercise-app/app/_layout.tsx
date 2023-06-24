import { config } from "../gluestack-ui.config";
import { queryClient } from "@/api";
import { GluestackUIProvider } from "@/components";
import { AuthProvider } from "@/hooks";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";

export default function Layout() {
	return (
		<GluestackUIProvider config={config.theme}>
			<QueryClientProvider client={queryClient}>
				<AuthProvider>
					<Stack screenOptions={{ headerShown: false }} />
				</AuthProvider>
			</QueryClientProvider>
		</GluestackUIProvider>
	);
}
