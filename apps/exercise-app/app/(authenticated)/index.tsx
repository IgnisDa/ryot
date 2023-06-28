import { getGraphqlClient } from "@/api";
import { Box, Button, Input } from "@/components";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import { useDebouncedState } from "@mantine/hooks";
import { ExercisesListDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, ScrollView, Text, View } from "react-native";

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
			<Box marginHorizontal="$2" marginVertical="$2">
				<Input>
					<Input.Input
						placeholder="Search for an exercise"
						autoCapitalize="none"
						onChange={({ nativeEvent: { text } }) => setQuery(text)}
					/>
				</Input>
				<Box>
					{exercises.data ? (
						<FlatList
							data={exercises.data}
							keyExtractor={(item) => item.name}
							renderItem={({ item }) => (
								<View>
									<Box marginVertical="$2">
										<Text>{item.name}</Text>
										<Text>{JSON.stringify(item.attributes)}</Text>
									</Box>
								</View>
							)}
						/>
					) : null}
				</Box>
				<Button
					onPress={async () => {
						await signOut();
						router.push(ROUTES.setup);
					}}
				>
					<Button.Text color="$white">Sign out</Button.Text>
				</Button>
			</Box>
		</View>
	);
}
