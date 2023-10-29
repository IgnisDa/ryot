import { useMantineTheme } from "@mantine/core";
import {
	CommitMediaDocument,
	type CommitMediaMutationVariables,
	CoreDetailsDocument,
	CoreEnabledFeaturesDocument,
	MetadataLot,
	UserDetailsDocument,
	UserPreferencesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import invariant from "tiny-invariant";
import { gqlClient } from "./services/api";
import { getStringAsciiValue } from "./utilities";

export function useUser() {
	const userDetails = useQuery({
		queryKey: ["userDetails"],
		queryFn: async () => {
			const { userDetails } = await gqlClient.request(UserDetailsDocument);
			return userDetails;
		},
	});
	return userDetails.data?.__typename === "User" ? userDetails.data : undefined;
}

export function useUserPreferences() {
	const prefs = useQuery({
		queryKey: ["enabledUserFeatures"],
		queryFn: async () => {
			const { userPreferences } = await gqlClient.request(
				UserPreferencesDocument,
			);
			return userPreferences;
		},
		staleTime: Infinity,
	});
	return prefs;
}

export function useEnabledCoreFeatures() {
	const enabledFeatures = useQuery({
		queryKey: ["enabledCoreFeatures"],
		queryFn: async () => {
			const { coreEnabledFeatures } = await gqlClient.request(
				CoreEnabledFeaturesDocument,
			);
			return coreEnabledFeatures;
		},
		staleTime: Infinity,
	});
	return enabledFeatures;
}

export function useCommitMedia(
	lot?: MetadataLot,
	// biome-ignore lint/suspicious/noExplicitAny: required
	onSuccess?: (id: any) => void,
) {
	const commitMedia = useMutation({
		mutationFn: async (variables: CommitMediaMutationVariables) => {
			invariant(lot, "Lot must be defined");
			const { commitMedia } = await gqlClient.request(
				CommitMediaDocument,
				variables,
			);
			return commitMedia;
		},
		onSuccess: (data) => {
			if (onSuccess) onSuccess(data.id);
		},
	});
	return commitMedia;
}

export function useCoreDetails() {
	const coreDetails = useQuery({
		queryKey: ["coreDetails"],
		queryFn: async () => {
			const { coreDetails } = await gqlClient.request(CoreDetailsDocument);
			return coreDetails;
		},
		staleTime: Infinity,
	});
	return coreDetails;
}

export function useGetMantineColor() {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	// taken from https://stackoverflow.com/questions/44975435/using-mod-operator-in-javascript-to-wrap-around#comment76926119_44975435
	const getColor = (input: string) =>
		colors[(getStringAsciiValue(input) + colors.length) % colors.length];

	return getColor;
}
