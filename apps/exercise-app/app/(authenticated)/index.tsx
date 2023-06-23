import { getGraphqlClient } from "../../lib/api";
import { Center } from "../../lib/components";
import { CoreEnabledFeaturesDocument } from "@ryot/generated/src/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView, Text } from "react-native";

export default function Page() {
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
			<Center>
				<Text>Authenticated route</Text>
				<Text>{JSON.stringify(query.data)}</Text>
			</Center>
		</SafeAreaView>
	);
}
