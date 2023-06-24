import { config } from "../gluestack-ui.config";
import { queryClient } from "@/api";
import { GluestackUIProvider } from "@/components";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";

export default function Layout() {
	return (
		<QueryClientProvider client={queryClient}>
			<GluestackUIProvider config={config.theme}>
				<Stack />
			</GluestackUIProvider>
		</QueryClientProvider>
	);
}
