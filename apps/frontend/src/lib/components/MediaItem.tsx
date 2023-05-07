import { gqlClient } from "@/lib/services/api";
import { Verb, getInitials, getLot, getVerb } from "@/lib/utilities";
import { Button, Flex, Image, Loader, Text } from "@mantine/core";
import {
	type BooksSearchQuery,
	CommitAudioBookDocument,
	CommitBookDocument,
	type CommitBookMutationVariables,
	CommitMovieDocument,
	CommitShowDocument,
	CommitVideoGameDocument,
	MediaConsumedDocument,
	MetadataLot,
	SeenStatus,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import { camelCase, startCase } from "lodash";
import { useRouter } from "next/router";
import { match } from "ts-pattern";

type Item = BooksSearchQuery["booksSearch"]["items"][number];

export const MediaItemWithoutUpdateModal = (props: {
	item: Item;
	lot: MetadataLot;
	imageOnClick: () => Promise<number>;
	children?: JSX.Element;
}) => {
	const router = useRouter();

	return (
		<Flex
			key={props.item.identifier}
			align={"center"}
			justify={"center"}
			direction={"column"}
		>
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
					router.push(`/media?item=${id}`);
				}}
			/>
			<Flex justify={"space-between"} w="100%">
				<Text c="dimmed">{props.item.publishYear}</Text>
				<Text c="dimmed">{startCase(camelCase(props.lot))}</Text>
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

	const mediaConsumed = useQuery(
		["mediaConsumed", lot, props.item],
		async () => {
			if (!lot) throw new Error("Lot if not defined");
			const { mediaConsumed } = await gqlClient.request(MediaConsumedDocument, {
				input: { identifier: props.item.identifier, lot },
			});
			return mediaConsumed;
		},
	);
	const commitMedia = useMutation(
		async (variables: CommitBookMutationVariables) => {
			return await match(lot)
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
				.with(MetadataLot.AudioBook, async () => {
					const { commitAudioBook } = await gqlClient.request(
						CommitAudioBookDocument,
						variables,
					);
					return commitAudioBook;
				})
				.run();
		},
	);

	const commitFunction = async () => {
		const { id } = await commitMedia.mutateAsync({
			identifier: props.item.identifier,
			index: props.idx,
			input: { query: props.query, offset: props.offset },
		});
		return id;
	};
	const seenElm = match(mediaConsumed.data?.seen)
		.with(
			SeenStatus.NotConsumed,
			SeenStatus.NotInDatabase,
			SeenStatus.ConsumedAtleastOnce,
			() => (
				<>
					<Button
						variant="outline"
						w="100%"
						compact
						loading={commitMedia.isLoading}
						onClick={async () => {
							const id = await commitFunction();
							router.push(`/media/update-progress?item=${id}`);
						}}
					>
						Mark as {getVerb(Verb.Read, props.lot)}
					</Button>
				</>
			),
		)
		.with(SeenStatus.Undetermined, SeenStatus.CurrentlyUnderway, () => <></>)
		.with(undefined, () => <Loader size="sm" />)
		.exhaustive();

	return (
		<MediaItemWithoutUpdateModal
			item={props.item}
			lot={props.lot}
			imageOnClick={async () => await commitFunction()}
		>
			{props.lot !== MetadataLot.Show ? (
				seenElm
			) : (
				<>
					<Button
						variant="outline"
						w="100%"
						compact
						loading={commitMedia.isLoading}
						onClick={async () => {
							const id = await commitFunction();
							router.push(`/media?item=${id}`);
						}}
					>
						Show details
					</Button>
				</>
			)}
		</MediaItemWithoutUpdateModal>
	);
}
