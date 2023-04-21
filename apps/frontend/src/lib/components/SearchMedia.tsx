import { gqlClient } from "@/lib/services/api";
import { getInitials } from "@/lib/utilities";
import { Box, Button, Flex, Image, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation } from "@tanstack/react-query";
import {
	type BooksSearchQuery,
	type CommitBookMutationVariables,
	MetadataLot,
	SeenStatus,
} from "@trackona/generated/graphql/backend/graphql";
import { COMMIT_BOOK } from "@trackona/graphql/backend/mutations";
import { camelCase, startCase } from "lodash";
import router from "next/router";
import { useState } from "react";
import { match } from "ts-pattern";
import UpdateProgressModal from "./UpdateProgressModal";

export default function SearchMedia(props: {
	item: BooksSearchQuery["booksSearch"]["items"][number];
	idx: number;
	query: string;
	offset: number;
	lot: MetadataLot;
	refetch: () => void;
}) {
	const [opened, { open, close }] = useDisclosure(false);
	const [metadataId, setMetadataId] = useState(0);
	const commitBook = useMutation(
		async (variables: CommitBookMutationVariables) => {
			const { commitBook } = await gqlClient.request(COMMIT_BOOK, variables);
			return commitBook;
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
	const seenElm = match(props.item.status)
		.with(SeenStatus.NotConsumed, SeenStatus.NotInDatabase, () => (
			<>
				<UpdateProgressModal
					item={props.item}
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
		))
		.with(SeenStatus.Undetermined, SeenStatus.ConsumedAtleastOnce, () => (
			<Box w={"100%"}>
				<Text fs="italic">You have read this</Text>
			</Box>
		))
		.with(SeenStatus.CurrentlyUnderway, () => (
			<Box w={"100%"}>
				<Text fs="italic">You are reading this</Text>
			</Box>
		))
		.exhaustive();

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
					const id = await commitFunction();
					setMetadataId(id);
					router.push(`/media?item=${id}&lot=${props.lot}`);
				}}
			/>
			<Flex justify={"space-between"} w="100%">
				<Text c="dimmed">{props.item.publishYear}</Text>
				<Text c="dimmed">{startCase(camelCase(props.lot))}</Text>
			</Flex>
			<Text w="100%" truncate fw={"bold"} mb="xs">
				{props.item.title}
			</Text>
			{seenElm}
		</Flex>
	);
}
