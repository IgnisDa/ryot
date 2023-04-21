import { gqlClient } from "@/lib/services/api";
import { getInitials } from "@/lib/utilities";
import {
	Box,
	Button,
	Flex,
	Group,
	Image,
	Modal,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { useMutation } from "@tanstack/react-query";
import {
	type BooksSearchQuery,
	type CommitBookMutationVariables,
	MetadataLot,
	ProgressUpdateAction,
	type ProgressUpdateMutationVariables,
	SeenStatus,
} from "@trackona/generated/graphql/backend/graphql";
import {
	COMMIT_BOOK,
	PROGRESS_UPDATE,
} from "@trackona/graphql/backend/mutations";
import router from "next/router";
import { useState } from "react";
import { match } from "ts-pattern";

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
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const commitBook = useMutation(
		async (variables: CommitBookMutationVariables) => {
			const { commitBook } = await gqlClient.request(COMMIT_BOOK, variables);
			return commitBook;
		},
	);
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			const { progressUpdate } = await gqlClient.request(
				PROGRESS_UPDATE,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: () => {
			props.refetch();
			close();
		},
	});

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
						<Button
							variant="outline"
							onClick={async () => {
								await progressUpdate.mutateAsync({
									input: {
										action: ProgressUpdateAction.JustStarted,
										metadataId,
									},
								});
							}}
						>
							Now
						</Button>
						<Button
							variant="outline"
							onClick={async () => {
								await progressUpdate.mutateAsync({
									input: {
										action: ProgressUpdateAction.InThePast,
										metadataId,
									},
								});
							}}
						>
							I do not remember
						</Button>
						<Group grow>
							<DateTimePicker
								dropdownType="modal"
								maxDate={new Date()}
								onChange={setSelectedDate}
								clearable
							/>
							<Button
								variant="outline"
								disabled={selectedDate === null}
								onClick={async () => {
									await progressUpdate.mutateAsync({
										input: {
											action: ProgressUpdateAction.InThePast,
											metadataId,
											date: selectedDate?.toISOString(),
										},
									});
								}}
							>
								Custom date and time
							</Button>
						</Group>
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
				<Text c="dimmed">Book</Text>
			</Flex>
			<Text w="100%" truncate fw={"bold"} mb="xs">
				{props.item.title}
			</Text>
			{seenElm}
		</Flex>
	);
}
