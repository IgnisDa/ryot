import {
	Button,
	NumberInput,
	SimpleGrid,
	Stack,
	Textarea,
	TextInput,
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
import { useEffect } from "react";
import { useSavedForm } from "~/lib/hooks/use-saved-form";
import { useApplicationEvents, useUserPreferences } from "~/lib/shared/hooks";
import {
	clientGqlService,
	queryClient,
	queryFactory,
} from "~/lib/shared/react-query";

const buildInput = (measurement?: UserMeasurement | null) =>
	({
		name: measurement?.name || "",
		comment: measurement?.comment || "",
		timestamp: measurement?.timestamp || new Date().toISOString(),
		information: {
			statistics: measurement?.information?.statistics || [],
			assets: {
				s3Images: [],
				s3Videos: [],
				remoteVideos: [],
				remoteImages: [],
			},
		},
	}) as UserMeasurementInput;

export const CreateOrUpdateMeasurementForm = (props: {
	closeMeasurementModal: () => void;
	measurementToUpdate?: UserMeasurement | null;
}) => {
	const events = useApplicationEvents();
	const userPreferences = useUserPreferences();

	const form = useSavedForm<UserMeasurementInput>({
		storageKeyPrefix: "CreateOrUpdateMeasurementForm",
		initialValues: buildInput(props.measurementToUpdate),
		validate: {
			information: {
				statistics: (value) =>
					value.some((s) => s.value)
						? null
						: "At least one statistic must have a value",
			},
		},
	});

	const createMeasurementMutation = useMutation({
		mutationFn: (input: UserMeasurementInput) =>
			clientGqlService.request(CreateOrUpdateUserMeasurementDocument, {
				input,
			}),
	});

	useEffect(() => {
		form.setValues(buildInput(props.measurementToUpdate));
	}, [props.measurementToUpdate]);

	return (
		<form
			onSubmit={form.onSubmit(async (values) => {
				await createMeasurementMutation.mutateAsync(values);
				notifications.show({
					color: "green",
					message: props.measurementToUpdate
						? "Your measurement has been updated"
						: "Your measurement has been created",
				});
				queryClient.invalidateQueries({
					queryKey: queryFactory.fitness.userMeasurementsList._def,
				});
				if (!props.measurementToUpdate) events.createMeasurement();
				form.clearSavedState();
				props.closeMeasurementModal();
			})}
		>
			<Stack>
				<DateTimePicker
					required
					label="Timestamp"
					value={new Date(form.values.timestamp)}
					onChange={(v) =>
						form.setFieldValue(
							"timestamp",
							v ? new Date(v).toISOString() : new Date().toISOString(),
						)
					}
				/>
				<TextInput label="Name" {...form.getInputProps("name")} />
				<SimpleGrid cols={2} style={{ alignItems: "end" }}>
					{userPreferences.fitness.measurements.statistics.map(
						({ name, unit }) => (
							<NumberInput
								key={name}
								decimalScale={3}
								label={changeCase(snakeCase(name)) + (unit ? ` (${unit})` : "")}
								value={
									form.values.information.statistics.find(
										(s) => s.name === name,
									)?.value
								}
								onChange={(v) => {
									const idx = form.values.information.statistics.findIndex(
										(s) => s.name === name,
									);
									const newStatistics = [...form.values.information.statistics];
									if (idx !== -1) newStatistics[idx].value = v.toString();
									else newStatistics.push({ name, value: v.toString() });

									form.setFieldValue("information.statistics", newStatistics);
								}}
							/>
						),
					)}
				</SimpleGrid>
				<Textarea label="Comment" {...form.getInputProps("comment")} />
				<Button
					mt="md"
					w="100%"
					type="submit"
					loading={createMeasurementMutation.isPending}
				>
					{props.measurementToUpdate ? "Update" : "Submit"}
				</Button>
			</Stack>
		</form>
	);
};
