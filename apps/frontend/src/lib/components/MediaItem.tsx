import UpdateProgressModal from "./UpdateProgressModal";
import { gqlClient } from "@/lib/services/api";
import { getInitials, getLot } from "@/lib/utilities";
import { Button, Flex, Image, Loader, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	type BooksSearchQuery,
	type CommitBookMutationVariables,
	MetadataLot,
	SeenStatus,
} from "@trackona/generated/graphql/backend/graphql";
import { COMMIT_BOOK, COMMIT_MOVIE } from "@trackona/graphql/backend/mutations";
import { MEDIA_CONSUMED } from "@trackona/graphql/backend/queries";
import { camelCase, startCase } from "lodash";
import { useRouter } from "next/router";
import { useState } from "react";
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
				src={props.item.images.at(0)}
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
	const [opened, { open, close }] = useDisclosure(false);
	const [metadataId, setMetadataId] = useState(0);
	const router = useRouter();
	const lot = getLot(router.query.lot);

	const mediaConsumed = useQuery(
		["mediaConsumed", lot, props.item],
		async () => {
			if (!lot) throw Error();
			const { mediaConsumed } = await gqlClient.request(MEDIA_CONSUMED, {
				input: { identifier: props.item.identifier, lot },
			});
			return mediaConsumed;
		},
		{ staleTime: Infinity },
	);
	const commitBook = useMutation(
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
				.otherwise(async () => {
					throw Error;
				});
		},
	);
	const commitFunction = async () => {
		const { id } = await commitBook.mutateAsync({
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
					<UpdateProgressModal
						lot={props.lot}
						title={props.item.title}
						metadataId={metadataId}
						onClose={close}
						opened={opened}
						refetch={props.refetch}
					/>
					<Button
						variant="outline"
						w="100%"
						compact
						loading={commitBook.isLoading}
						onClick={async () => {
							const id = await commitFunction();
							setMetadataId(id);
							open();
						}}
					>
						Mark as read
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
			{seenElm}
		</MediaItemWithoutUpdateModal>
	);
}
