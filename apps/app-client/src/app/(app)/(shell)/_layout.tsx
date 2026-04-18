import { Stack } from "expo-router";

export default function ShellLayout() {
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Screen name="e/[entityId]" options={{ headerShown: true, title: "Details" }} />
			<Stack.Screen
				name="[workspace]/settings"
				options={{ headerShown: true, title: "Settings" }}
			/>
		</Stack>
	);
}
