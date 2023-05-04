import { gqlClient } from "@/lib/services/api";
import { Verb, getInitials, getLot, getVerb } from "@/lib/utilities";
import { Button, Flex, Image, Loader, Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	type BooksSearchQuery,
	type CommitBookMutationVariables,
	MetadataLot,
	SeenStatus,
} from "@trackona/generated/graphql/backend/graphql";
import {
	COMMIT_BOOK,
	COMMIT_MOVIE,
	COMMIT_SHOW,
	COMMIT_VIDEO_GAME,
} from "@trackona/graphql/backend/mutations";
import { MEDIA_CONSUMED } from "@trackona/graphql/backend/queries";
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
			const { mediaConsumed } = await gqlClient.request(MEDIA_CONSUMED, {
				input: { identifier: props.item.identifier, lot: lot! },
			});
			return mediaConsumed;
		},
		{ staleTime: Infinity },
	);
	const commitMedia = useMutation(
		async (variables: CommitBookMutationVariables) => {
			return await match(lot)
				.with(MetadataLot.Book, async () => {
					const { commitBook } = await gqlClient.request(
						COMMIT_BOOK,
						variables,
					);
					return commitBook;
				})
				.with(MetadataLot.Movie, async () => {
					const { commitMovie } = await gqlClient.request(
						COMMIT_MOVIE,
						variables,
					);
					return commitMovie;
				})
				.with(MetadataLot.Show, async () => {
					const { commitShow } = await gqlClient.request(
						COMMIT_SHOW,
						variables,
					);
					return commitShow;
				})
				.with(MetadataLot.VideoGame, async () => {
					const { commitVideoGame } = await gqlClient.request(
						COMMIT_VIDEO_GAME,
						variables,
					);
					return commitVideoGame;
				})
				.otherwise(async () => {
					throw Error("can not commit media");
				});
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
