import {
	Alert,
	Button,
	Group,
	Paper,
	Stack,
	Text,
	Textarea,
} from "@mantine/core";
import {
	DeletePersonalNoteDocument,
	PersonalNoteDocument,
	SetPersonalNoteDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useUserDetails } from "~/lib/shared/hooks";
import { clientGqlService, queryClient } from "~/lib/shared/react-query";
import { openConfirmationModal } from "~/lib/shared/ui-utils";

export function PersonalNote(props: { metadataId: string }) {
	const user = useUserDetails();
	return (
		<PersonalNoteEditor
			key={`${user.id}:${props.metadataId}`}
			metadataId={props.metadataId}
			userId={user.id}
		/>
	);
}

function PersonalNoteEditor(props: { userId: string; metadataId: string }) {
	const [draft, setDraft] = useState<string | null>(null);
	const queryKey = ["personalNote", props.userId, props.metadataId];
	const note = useQuery({
		queryKey,
		placeholderData: undefined,
		queryFn: () =>
			clientGqlService.request(PersonalNoteDocument, {
				metadataId: props.metadataId,
			}),
	});
	const text = draft ?? note.data?.personalNote?.text ?? "";
	const savedText = note.data?.personalNote?.text ?? "";
	const save = useMutation({
		mutationFn: (value: string) =>
			clientGqlService.request(SetPersonalNoteDocument, {
				text: value,
				metadataId: props.metadataId,
			}),
		onSuccess: (result, value) => {
			queryClient.setQueryData(queryKey, {
				personalNote: result.setPersonalNote,
			});
			setDraft((current) => (current === value ? null : current));
		},
	});
	const remove = useMutation({
		mutationFn: () =>
			clientGqlService.request(DeletePersonalNoteDocument, {
				metadataId: props.metadataId,
			}),
		onSuccess: () => {
			setDraft(null);
			queryClient.setQueryData(queryKey, { personalNote: null });
		},
	});
	const pending = save.isPending || remove.isPending;
	return (
		<Paper p="md" withBorder>
			<Stack gap="xs">
				<Text fw={600}>Personal note</Text>
				<Text size="sm" c="dimmed">
					Only visible to you. Separate from reviews and ratings.
				</Text>
				{note.isError ? (
					<Alert color="red">
						Unable to load your note.{" "}
						<Button variant="subtle" onClick={() => note.refetch()}>
							Retry
						</Button>
					</Alert>
				) : null}
				<Textarea
					autosize
					minRows={3}
					maxRows={12}
					value={text}
					label="Your note"
					disabled={note.isPending || note.isError || pending}
					onChange={(event) => {
						setDraft(event.currentTarget.value);
						save.reset();
						remove.reset();
					}}
					error={
						Array.from(text).length > 16000
							? "Maximum 16,000 characters"
							: undefined
					}
					placeholder="Why you saved this, who recommended it, or anything you want to remember"
				/>
				{save.isError || remove.isError ? (
					<Alert color="red">
						Unable to update your note. Your draft is still here; try again.
					</Alert>
				) : null}
				{save.isSuccess ? (
					<Text size="sm" c="dimmed">
						Note saved.
					</Text>
				) : null}
				{remove.isSuccess ? (
					<Text size="sm" c="dimmed">
						Note deleted.
					</Text>
				) : null}
				<Group justify="space-between" wrap="wrap">
					<Button
						loading={save.isPending}
						onClick={() => save.mutate(text)}
						disabled={
							note.isPending ||
							note.isError ||
							pending ||
							text === savedText ||
							!text.trim() ||
							Array.from(text).length > 16000
						}
					>
						Save note
					</Button>
					{note.data?.personalNote ? (
						<Button
							color="red"
							variant="subtle"
							loading={remove.isPending}
							disabled={pending}
							onClick={() =>
								openConfirmationModal("Delete your personal note?", () =>
									remove.mutate(),
								)
							}
						>
							Delete note
						</Button>
					) : null}
				</Group>
			</Stack>
		</Paper>
	);
}
