import { getGraphqlClient } from "@/api";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import { useDebouncedState } from "@mantine/hooks";
import { Button, Input } from "@rneui/themed";
import { ExercisesListDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";

export default function Page() {
	const { signOut } = useAuth();
	const router = useRouter();
	const [query, setQuery] = useDebouncedState("", 1000);
	const [page, _setpage] = useState(1);

	const exercises = useQuery({
		queryKey: ["exercises", query, page],
		queryFn: async () => {
			const client = await getGraphqlClient();
			const { exercisesList } = await client.request(ExercisesListDocument, {
				input: { page, query },
			});
			return exercisesList;
		},
	});

	return (
		<View>
			<Button
				onPress={async () => {
					await signOut();
					router.push(ROUTES.setup);
				}}
			>
				Sign out
			</Button>
			<Input
				placeholder="Search for an exercise"
				autoCapitalize="none"
				onChange={({ nativeEvent: { text } }) => setQuery(text)}
			/>
			{exercises.data ? (
				<FlatList
					data={exercises.data}
					keyExtractor={(item) => item.name}
					renderItem={({ item }) => (
						<View>
							<Text>{item.name}</Text>
							<Text>{JSON.stringify(item.attributes)}</Text>
						</View>
					)}
				/>
			) : null}
		</View>
	);
}
