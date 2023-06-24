import { Button } from "@/components";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text } from "react-native";

export default function Layout() {
	const router = useRouter();
	const { authData, loading } = useAuth();

	useEffect(() => {
		if (!loading && !authData) router.push(ROUTES.setup);
	}, [authData, loading]);

	return (
		<>
			<Text>This is an authenticated and server url complete route</Text>
			<Text>{JSON.stringify(authData)}</Text>
			<Button
				onPress={async () => {
					await AsyncStorage.clear();
				}}
			>
				<Button.Text color="$white">Clear async storage</Button.Text>
			</Button>
			<Stack screenOptions={{ headerShown: false }} />
		</>
	);
}
