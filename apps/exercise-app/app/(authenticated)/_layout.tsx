import { Text } from "react-native";
import { Stack } from "expo-router";

export default function Layout() {
	return (
		<>
			<Text>This is an authenticated and server url complete route</Text>
			<Stack screenOptions={{ headerShown: false }} />
		</>
	);
}
