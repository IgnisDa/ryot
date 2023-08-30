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
import { gqlClient } from "../services/api";

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
	const prefs = useQuery(
		["enabledUserFeatures"],
		async () => {
			const { userPreferences } = await gqlClient.request(
				UserPreferencesDocument,
			);
			return userPreferences;
		},
		{ staleTime: Infinity },
	);
	return prefs;
}

export function useEnabledCoreFeatures() {
	const enabledFeatures = useQuery(
		["enabledCoreFeatures"],
		async () => {
			const { coreEnabledFeatures } = await gqlClient.request(
				CoreEnabledFeaturesDocument,
			);
			return coreEnabledFeatures;
		},
		{ staleTime: Infinity },
	);
	return enabledFeatures;
}

export function useCommitMedia(
	lot?: MetadataLot,
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
	const coreDetails = useQuery(
		["coreDetails"],
		async () => {
			const { coreDetails } = await gqlClient.request(CoreDetailsDocument);
			return coreDetails;
		},
		{ staleTime: Infinity },
	);
	return coreDetails;
}
