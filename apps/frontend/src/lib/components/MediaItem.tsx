import { ROUTES } from "../constants";
import { gqlClient } from "@/lib/services/api";
import {
	Verb,
	changeCase,
	getInitials,
	getLot,
	getVerb,
} from "@/lib/utilities";
import { Button, Flex, Image, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	AddMediaToCollectionDocument,
	type AddMediaToCollectionMutationVariables,
	type BooksSearchQuery,
	CommitAudioBookDocument,
	CommitBookDocument,
	type CommitBookMutationVariables,
	CommitMovieDocument,
	CommitPodcastDocument,
	CommitShowDocument,
	CommitVideoGameDocument,
	MetadataLot,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/router";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";

type Item = BooksSearchQuery["booksSearch"]["items"][number];

export const MediaItemWithoutUpdateModal = (props: {
	item: Item;
	lot: MetadataLot;
	imageOnClick: () => Promise<number>;
	children?: JSX.Element;
	imageIsLoading?: boolean;
}) => {
	const router = useRouter();

	return (
		<Flex
			key={props.item.identifier}
			align={"center"}
			justify={"center"}
			direction={"column"}
			pos={"relative"}
		>
			{props.imageIsLoading ? (
				<Loader
					pos={"absolute"}
					style={{ zIndex: 999 }}
					top={10}
					left={10}
					color="red"
					variant="bars"
					size="sm"
				/>
			) : null}
			<Image
				src={props.item.posterImages.at(0)}
				radius={"md"}
				height={250}
				withPlaceholder
				placeholder={<Text size={60}>{getInitials(props.item.title)}</Text>}
				style={{ cursor: "pointer" }}
				alt={`Image for ${props.item.title}`}
				onClick={async () => {
					const id = await props.imageOnClick();
					router.push(`${ROUTES.media.details}?item=${id}`);
				}}
				sx={(_t) => ({
					":hover": { transform: "scale(1.02)" },
					transitionProperty: "transform",
					transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
					transitionDuration: "150ms",
				})}
			/>
			<Flex justify={"space-between"} w="100%">
				<Text c="dimmed">{props.item.publishYear}</Text>
				<Text c="dimmed">{changeCase(props.lot)}</Text>
			</Flex>
			<Text w="100%" truncate fw={"bold"} mb="xs">
				{props.item.title}
			</Text>
			{props.children}
		</Flex>
	);
};

export default function (props: {
	item: Item;
	idx: number;
	query: string;
	offset: number;
	lot: MetadataLot;
	refetch: () => void;
}) {
	const router = useRouter();
	const lot = getLot(router.query.lot);

	const commitMedia = useMutation(
		async (variables: CommitBookMutationVariables) => {
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
	);
	const addMediaToCollection = useMutation({
		mutationFn: async (variables: AddMediaToCollectionMutationVariables) => {
			const { addMediaToCollection } = await gqlClient.request(
				AddMediaToCollectionDocument,
				variables,
			);
			return addMediaToCollection;
		},
		onSuccess: () => {
			notifications.show({
				title: "Success",
				message: "Media added to watchlist successfully",
			});
		},
	});

	const commitFunction = async () => {
		const { id } = await commitMedia.mutateAsync({
			identifier: props.item.identifier,
		});
		return id;
	};

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			lot={props.lot}
			imageOnClick={async () => await commitFunction()}
			imageIsLoading={commitMedia.isLoading}
		>
			<>
				{props.lot !== MetadataLot.Show ? (
					<Button
						variant="outline"
						w="100%"
						compact
						onClick={async () => {
							const id = await commitFunction();
							router.push(`${ROUTES.media.updateProgress}?item=${id}`);
						}}
					>
						Mark as {getVerb(Verb.Read, props.lot)}
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							w="100%"
							compact
							onClick={async () => {
								const id = await commitFunction();
								router.push(`${ROUTES.media.details}?item=${id}`);
							}}
						>
							Show details
						</Button>
					</>
				)}
				<Button
					mt="xs"
					variant="outline"
					w="100%"
					compact
					onClick={async () => {
						const id = await commitFunction();
						addMediaToCollection.mutate({
							input: { collectionName: "Watchlist", mediaId: id },
						});
					}}
				>
					Add to Watchlist
				</Button>
			</>
		</MediaItemWithoutUpdateModal>
	);
}
