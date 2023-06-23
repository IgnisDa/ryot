import { getGraphqlClient } from "../lib/api";
import { CoreEnabledFeaturesDocument } from "@ryot/generated/src/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

export default function Page() {
	const { data } = useQuery({
		queryKey: ["coreEnabledFeatures"],
		queryFn: async () => {
			const gqlClient = await getGraphqlClient();
			const { coreEnabledFeatures } = await gqlClient.request(
				CoreEnabledFeaturesDocument,
			);
			return coreEnabledFeatures;
		},
	});

	return (
		<View>
			<Text>Index page!</Text>
			<Text>Some data: {JSON.stringify(data)}</Text>
		</View>
	);
}
