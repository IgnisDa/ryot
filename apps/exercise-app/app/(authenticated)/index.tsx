import { getGraphqlClient } from "@/api";
import { changeCase } from "@ryot/utilities";
import { SearchBar } from "@rneui/base";
import { Avatar } from "@rneui/themed";
import { ExercisesListDocument } from "@ryot/generated/graphql/backend/graphql";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Page() {
	const [query, setQuery] = useState("");

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
			<SearchBar
				placeholder="Search for an exercise"
				autoCapitalize="none"
				onChangeText={setQuery}
				value={query}
				showLoading={exercises.isFetching}
			/>
			{exercises.data ? (
				<FlatList
					data={exercises.data.pages.flatMap((p) => p.items)}
					onEndReached={loadMore}
					onEndReachedThreshold={0.3}
					showsVerticalScrollIndicator={false}
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
							<Avatar
								source={{ uri: item.attributes.images[1] }}
								size={55}
								rounded
							/>
							<View>
								<Text style={{ fontWeight: "bold", fontSize: 16 }}>
									{item.name}
								</Text>
								<View style={{ flexDirection: "row", gap: 5 }}>
									<Text>{changeCase(item.attributes.primaryMuscles[0])}</Text>
									<Text>• {changeCase(item.attributes.category)}</Text>
								</View>
							</View>
						</View>
					)}
				/>
			) : null}
		</SafeAreaView>
	);
}
