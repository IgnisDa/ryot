import { config } from "../gluestack-ui.config";
import { GluestackUIProvider } from "../lib/components";
import { Stack } from "expo-router";

export default function Layout() {
	return (
		<GluestackUIProvider config={config.theme}>
			<Stack />
		</GluestackUIProvider>
	);
}
