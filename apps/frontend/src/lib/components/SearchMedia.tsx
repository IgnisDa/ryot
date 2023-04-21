import { Image, Text, Flex, Button, Modal, Title, Stack } from "@mantine/core";
import {
	SeenStatus,
	type BooksSearchQuery,
	type CommitBookMutationVariables,
	MetadataLot,
} from "@trackona/generated/graphql/backend/graphql";
import { match } from "ts-pattern";
import { getInitials } from "@/lib/utilities";
import { useDisclosure } from "@mantine/hooks";
import router from "next/router";
import { useState } from "react";
import { DateTimePicker } from "@mantine/dates";
import { useMutation } from "@tanstack/react-query";
import { COMMIT_BOOK } from "@trackona/graphql/backend/mutations";
import { gqlClient } from "../services/api";

export default function SearchMedia(props: {
	item: BooksSearchQuery["booksSearch"]["items"][number];
	idx: number;
	query: string;
	offset: number;
	lot: MetadataLot;
}) {
	const [opened, { open, close }] = useDisclosure(false);
	const [metadataId, setMetadataId] = useState<number>(0);
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
				<Modal opened={opened} onClose={close} withCloseButton={false} centered>
					<Stack>
						<Title order={3}>When did you read "{props.item.title}"?</Title>
						<Button variant="outline">Now</Button>
						<Button variant="outline">At release date</Button>
						<Button variant="outline">I do not remember</Button>
						<DateTimePicker
							label="Custom date and time"
							dropdownType="modal"
							maxDate={new Date()}
							defaultValue={new Date()}
						/>
						<Button variant="outline" color="red" onClick={close}>
							Cancel
						</Button>
					</Stack>
				</Modal>
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
		.with(SeenStatus.Undetermined, SeenStatus.ConsumedAtleastOnce, () => <></>)
		.with(SeenStatus.CurrentlyUnderway, () => <>You are reading this</>)
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
				<Text c="dimmed">Book</Text>
			</Flex>
			<Text w="100%" truncate fw={"bold"} mb="xs">
				{props.item.title}
			</Text>
			{seenElm}
		</Flex>
	);
}
