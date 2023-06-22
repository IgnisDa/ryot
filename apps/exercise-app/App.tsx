import { config } from "./gluestack-ui.config";
import { Button, GluestackUIProvider } from "./lib/components";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
	return (
		<GluestackUIProvider config={config.theme}>
			<View style={styles.container}>
				<Text>Open up App.tsx to start working on your app!</Text>
				<Text>This is a small test!</Text>
				<Button onPress={() => alert("Clicked!")}>
					<Button.Text>Click me!</Button.Text>
				</Button>
			</View>
		</GluestackUIProvider>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#cbd5e1",
		alignItems: "center",
		justifyContent: "center",
	},
});
