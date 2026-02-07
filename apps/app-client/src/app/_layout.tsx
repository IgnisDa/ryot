// oxlint-disable-next-line import/no-unassigned-import
import "@/global.css";
import { RegistryProvider } from "@effect-atom/atom-react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
	return (
		<RegistryProvider>
			<SafeAreaProvider>
				<Slot />
				{/* oxlint-disable-next-line react/style-prop-object */}
				<StatusBar style="auto" />
			</SafeAreaProvider>
		</RegistryProvider>
	);
}
