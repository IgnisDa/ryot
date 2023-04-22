import { gqlClient } from "@/lib/services/api";
import { Button, Group, Modal, Stack, Title } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useMutation } from "@tanstack/react-query";
import {
	ProgressUpdateAction,
	type ProgressUpdateMutationVariables,
} from "@trackona/generated/graphql/backend/graphql";
import { PROGRESS_UPDATE } from "@trackona/graphql/backend/mutations";
import { useState } from "react";

export default function UpdateProgressModal(props: {
	opened: boolean;
	onClose: () => void;
	metadataId: number;
	refetch: () => void;
	title: string;
}) {
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
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
			props.onClose();
		},
	});

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<Stack>
				<Title order={3}>When did you read "{props.title}"?</Title>
				<Button
					variant="outline"
					onClick={async () => {
						await progressUpdate.mutateAsync({
							input: {
								action: ProgressUpdateAction.Now,
								metadataId: props.metadataId,
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
								metadataId: props.metadataId,
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
									metadataId: props.metadataId,
									date: selectedDate,
								},
							});
						}}
					>
						Custom date
					</Button>
				</Group>
				<Button variant="outline" color="red" onClick={props.onClose}>
					Cancel
				</Button>
			</Stack>
		</Modal>
	);
}
