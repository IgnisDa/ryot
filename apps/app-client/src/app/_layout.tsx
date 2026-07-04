// oxlint-disable-next-line import/no-unassigned-import
import "@/global.css";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<Slot />
			{/* oxlint-disable-next-line react/style-prop-object */}
			<StatusBar style="auto" />
		</SafeAreaProvider>
	);
}
