import { ScreenContent } from "components/ScreenContent";
import { StatusBar } from "expo-status-bar";

import "./global.css";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function App() {
	return (
		<SafeAreaProvider>
			<ScreenContent title="Home" path="App.tsx"></ScreenContent>
			<StatusBar style="auto" />
		</SafeAreaProvider>
	);
}
