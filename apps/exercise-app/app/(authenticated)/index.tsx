import { getGraphqlClient } from "@/api";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import { useDebouncedState } from "@mantine/hooks";
import { Button, Input } from "@rneui/themed";
import { ExercisesListDocument } from "@ryot/generated/graphql/backend/graphql";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

export default function Page() {
	const { signOut } = useAuth();
	const router = useRouter();
	const [query, setQuery] = useDebouncedState("", 1000);

	const exercises = useInfiniteQuery({
		queryKey: ["exercises", query],
		queryFn: async ({ pageParam: page = 1 }) => {
			const client = await getGraphqlClient();
			const { exercisesList } = await client.request(ExercisesListDocument, {
				input: { page, query },
			});
			return exercisesList;
		},
		getNextPageParam: (lastPage) => {
			if (lastPage.nextPage) return lastPage.nextPage;
			return lastPage;
		},
	});

	const loadMore = () => {
		if (exercises.hasNextPage) exercises.fetchNextPage();
	};

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
					data={exercises.data.pages.flatMap((p) => p.items)}
					onEndReached={loadMore}
					onEndReachedThreshold={0.3}
					keyExtractor={(item) => item.name}
					renderItem={({ item }) => (
						<View>
							<Text>{item.name}</Text>
						</View>
					)}
				/>
			) : null}
			{exercises.isLoading ? <ActivityIndicator /> : null}
		</View>
	);
}
