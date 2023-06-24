import AsyncStorage from "@react-native-async-storage/async-storage";
import { GraphQLClient, createGqlClient } from "@ryot/graphql/client";
import { QueryClient } from "@tanstack/react-query";

let gqlClient: GraphQLClient;

export const URL_KEY = "instanceUrl";
export const AUTH_KEY = "authToken";

export const getGraphqlClient = async () => {
	if (gqlClient) return gqlClient;
	if (typeof AsyncStorage !== "undefined") {
		const baseUrl = await AsyncStorage.getItem(URL_KEY);
		if (!baseUrl) return;
		gqlClient = createGqlClient(baseUrl);
		return gqlClient;
	}
	return;
};

export const queryClient = new QueryClient();
