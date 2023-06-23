import { Stack } from "expo-router";
import { config } from "../gluestack-ui.config";
import { GluestackUIProvider } from "../lib/components";

export default function Layout() {
	return (
		<GluestackUIProvider config={config.theme}>
			<Stack />
		</GluestackUIProvider>
	);
}
