import { gqlClient } from "../services/api";
import {
	CommitAudioBookDocument,
	CommitBookDocument,
	type CommitBookMutationVariables,
	CommitMovieDocument,
	CommitPodcastDocument,
	CommitShowDocument,
	CommitVideoGameDocument,
	MetadataLot,
	UserDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";

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
		mutationFn: async (variables: CommitBookMutationVariables) => {
			invariant(lot, "Lot must be defined");
			return await match(lot)
				.with(MetadataLot.AudioBook, async () => {
					const { commitAudioBook } = await gqlClient.request(
						CommitAudioBookDocument,
						variables,
					);
					return commitAudioBook;
				})
				.with(MetadataLot.Book, async () => {
					const { commitBook } = await gqlClient.request(
						CommitBookDocument,
						variables,
					);
					return commitBook;
				})
				.with(MetadataLot.Movie, async () => {
					const { commitMovie } = await gqlClient.request(
						CommitMovieDocument,
						variables,
					);
					return commitMovie;
				})
				.with(MetadataLot.Podcast, async () => {
					const { commitPodcast } = await gqlClient.request(
						CommitPodcastDocument,
						variables,
					);
					return commitPodcast;
				})
				.with(MetadataLot.Show, async () => {
					const { commitShow } = await gqlClient.request(
						CommitShowDocument,
						variables,
					);
					return commitShow;
				})
				.with(MetadataLot.VideoGame, async () => {
					const { commitVideoGame } = await gqlClient.request(
						CommitVideoGameDocument,
						variables,
					);
					return commitVideoGame;
				})
				.exhaustive();
		},
		onSuccess: (data) => {
			if (onSuccess) onSuccess(data.id);
		},
	});
	return commitMedia;
}
