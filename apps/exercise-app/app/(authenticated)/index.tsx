import { getGraphqlClient } from "@/api";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import { useDebouncedState } from "@mantine/hooks";
import { Button, Input, Image } from "@rneui/themed";
import { ExercisesListDocument } from "@ryot/generated/graphql/backend/graphql";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
		getNextPageParam: (lastPage) => lastPage.nextPage,
	});

	const loadMore = () => {
		if (exercises.hasNextPage) exercises.fetchNextPage();
	};

	return (
		<SafeAreaView style={{ paddingHorizontal: 15 }}>
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
						<View
							style={{
								flex: 1,
								flexDirection: "row",
								marginVertical: 10,
								alignItems: "center",
								gap: 10,
							}}
						>
							<Image
								source={{ uri: item.attributes.images[0] }}
								style={{
									width: 50,
									height: 50,
									borderRadius: 150 / 2,
									resizeMode: "contain",
									overflow: "hidden",
								}}
							/>
							<Text>{item.name}</Text>
						</View>
					)}
				/>
			) : null}
			{exercises.isFetching ? <ActivityIndicator /> : null}
		</SafeAreaView>
	);
}
