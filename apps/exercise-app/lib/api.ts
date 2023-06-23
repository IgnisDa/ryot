import { createGqlClient, GraphqlClient } from "@ryot/graphql/client";
import { QueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

let gqlClient: GraphqlClient;
const KEY = "instanceUrl";

export const getGraphqlClient = async () => {
	if (gqlClient) return gqlClient;
	const baseUrl =
		typeof AsyncStorage !== "undefined"
			? (await AsyncStorage.getItem(KEY)) ?? "/"
			: "";
	gqlClient = createGqlClient(baseUrl);
	return gqlClient;
};

export const queryClient = new QueryClient();
