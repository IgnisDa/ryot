import { gqlClient } from "../services/api";
import {
	MetadataLot,
	UserDetailsDocument,
	CommitMediaDocument,
	type CommitMediaMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import invariant from "tiny-invariant";

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
