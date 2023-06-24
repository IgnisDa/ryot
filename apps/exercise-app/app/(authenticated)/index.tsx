import { getGraphqlClient } from "@/api";
import { Button, Center } from "@/components";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CoreEnabledFeaturesDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import { SafeAreaView, Text } from "react-native";

export default function Page() {
	const { authData, signOut } = useAuth();
	const router = useRouter();

	const query = useQuery({
		queryKey: ["query"],
		queryFn: async () => {
			const client = await getGraphqlClient();
			const { coreEnabledFeatures } = await client.request(
				CoreEnabledFeaturesDocument,
			);
			return coreEnabledFeatures;
		},
	});

	return (
		<SafeAreaView style={{ flex: 1 }}>
			<Text>This is an authenticated and server url complete route</Text>
			<Text>{JSON.stringify(authData)}</Text>
			<Button
				onPress={async () => {
					await AsyncStorage.clear();
				}}
			>
				<Button.Text color="$white">Clear async storage</Button.Text>
			</Button>
			<Button
				onPress={async () => {
					await signOut();
					router.push(ROUTES.setup);
				}}
			>
				<Button.Text color="$white">Sign out</Button.Text>
			</Button>
			<Center>
				<Text>Authenticated route</Text>
				<Text>{JSON.stringify(query.data)}</Text>
				<Link href={ROUTES.setup}>Setup page</Link>
			</Center>
		</SafeAreaView>
	);
}
