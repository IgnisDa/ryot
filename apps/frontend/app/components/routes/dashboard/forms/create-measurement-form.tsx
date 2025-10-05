import {
	Button,
	NumberInput,
	SimpleGrid,
	Stack,
	TextInput,
	Textarea,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import {
	CreateOrUpdateUserMeasurementDocument,
	type UserMeasurement,
	type UserMeasurementInput,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import { useMutation } from "@tanstack/react-query";
import { produce } from "immer";
import { useState } from "react";
import { useApplicationEvents, useUserPreferences } from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";

export const CreateMeasurementForm = (props: {
	closeMeasurementModal: () => void;
	measurementToEdit?: UserMeasurement | null;
}) => {
	const events = useApplicationEvents();
	const userPreferences = useUserPreferences();

	const [input, setInput] = useState<UserMeasurementInput>(() => {
		return {
			name: props.measurementToEdit?.name || "",
			comment: props.measurementToEdit?.comment || "",
			timestamp: props.measurementToEdit?.timestamp || new Date().toISOString(),
			information: {
				statistics: props.measurementToEdit?.information.statistics || [],
				assets: {
					s3Images: [],
					s3Videos: [],
					remoteVideos: [],
					remoteImages: [],
				},
			},
		};
	});

	const createMeasurementMutation = useMutation({
		mutationFn: () =>
			clientGqlService.request(CreateOrUpdateUserMeasurementDocument, {
				input,
			}),
	});

	return (
		<Stack>
			<DateTimePicker
				required
				label="Timestamp"
				value={new Date(input.timestamp)}
				onChange={(v) =>
					setInput(
						produce(input, (draft) => {
							draft.timestamp = v
								? new Date(v).toISOString()
								: new Date().toISOString();
						}),
					)
				}
			/>
			<TextInput
				label="Name"
				value={input.name ?? ""}
				onChange={(e) =>
					setInput(
						produce(input, (draft) => {
							draft.name = e.target.value;
						}),
					)
				}
			/>
			<SimpleGrid cols={2} style={{ alignItems: "end" }}>
				{userPreferences.fitness.measurements.statistics.map(({ name }) => (
					<NumberInput
						key={name}
						decimalScale={3}
						label={changeCase(snakeCase(name))}
						value={
							input.information.statistics.find((s) => s.name === name)?.value
						}
						onChange={(v) => {
							setInput(
								produce(input, (draft) => {
									const idx = draft.information.statistics.findIndex(
										(s) => s.name === name,
									);
									if (idx !== -1) {
										draft.information.statistics[idx].value = v.toString();
									} else {
										draft.information.statistics.push({
											name,
											value: v.toString(),
										});
									}
								}),
							);
						}}
					/>
				))}
			</SimpleGrid>
			<Textarea
				label="Comment"
				value={input.comment ?? ""}
				onChange={(e) =>
					setInput(
						produce(input, (draft) => {
							draft.comment = e.target.value;
						}),
					)
				}
			/>
			<Button
				loading={createMeasurementMutation.isPending}
				disabled={
					createMeasurementMutation.isPending ||
					!input.information.statistics.some((s) => s.value)
				}
				onClick={async () => {
					events.createMeasurement();
					await createMeasurementMutation.mutateAsync();
					notifications.show({
						color: "green",
						message: props.measurementToEdit
							? "Your measurement has been updated"
							: "Your measurement has been created",
					});
					queryClient.invalidateQueries({
						queryKey: queryFactory.fitness.userMeasurementsList._def,
					});
					props.closeMeasurementModal();
				}}
			>
				{props.measurementToEdit ? "Update" : "Submit"}
			</Button>
		</Stack>
	);
};
