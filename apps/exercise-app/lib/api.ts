import { AuthData } from "./hooks";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
	GraphQLClient,
	createGqlClient,
	getAuthHeader,
} from "@ryot/graphql/client";
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

export const getAuthHeaders = async () => {
	const authData: AuthData = JSON.parse(await AsyncStorage.getItem(AUTH_KEY));
	const headers = getAuthHeader(authData.token);
	return headers;
};
