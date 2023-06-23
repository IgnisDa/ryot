import { Stack } from "expo-router";
import { Text } from "react-native";

export default function Layout() {
	return (
		<>
			<Text>This is an authenticated and server url complete route</Text>
			<Stack screenOptions={{ headerShown: false }} />
		</>
	);
}
