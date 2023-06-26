import { getAuthHeaders, getGraphqlClient } from "@/api";
import { Button, Center } from "@/components";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import {
	ExercisesListDocument,
	UserEnabledFeaturesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { SafeAreaView, Text } from "react-native";

export default function Page() {
	const { authData, signOut } = useAuth();
	const router = useRouter();

	const exercises = useQuery({
		queryKey: ["exercises"],
		queryFn: async () => {
			const client = await getGraphqlClient();
			const { exercisesList } = await client.request(ExercisesListDocument, {
				input: { page: 0 },
			});
			return exercisesList;
		},
	});

	const userEnabledFeatures = useQuery({
		queryKey: ["userEnabledFeatures"],
		queryFn: async () => {
			const client = await getGraphqlClient();
			const { userEnabledFeatures } = await client.request(
				UserEnabledFeaturesDocument,
				undefined,
				await getAuthHeaders(),
			);
			return userEnabledFeatures;
		},
	});

	return (
		<SafeAreaView style={{ flex: 1 }}>
			<Text>This is an authenticated and server url complete route</Text>
			<Text>{JSON.stringify(authData)}</Text>
			<Button
				onPress={async () => {
					await signOut();
					router.push(ROUTES.setup);
				}}
			>
				<Button.Text color="$white">Sign out</Button.Text>
			</Button>
			<Center>
				<Text>Authenticated query</Text>
				<Text>{JSON.stringify(userEnabledFeatures.data)}</Text>
			</Center>
			<Center>
				<Text>Unauthenticated query</Text>
				<Text>{JSON.stringify(exercises.data)}</Text>
			</Center>
		</SafeAreaView>
	);
}
