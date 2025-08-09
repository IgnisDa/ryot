import { Button, Group, Modal, Stack } from "@mantine/core";

import { FormError } from "~/components/PageStates";
import type { CreateEntitySchemaPayload } from "~/features/entity-schemas/form";
import { EntitySchemaPropertiesBuilder } from "~/features/entity-schemas/properties-builder";
import { useCreateEntitySchemaForm } from "~/features/entity-schemas/use-form";
import { TrackerIcon, trackerIconSelectData } from "~/features/trackers/icons";
import { createFormSubmitHandler } from "~/hooks/forms";

export interface EntitySchemaCreateModalProps {
	opened: boolean;
	trackerId: string;
	isLoading: boolean;
	onClose: () => void;
	errorMessage: string | null;
	onSubmit: (payload: CreateEntitySchemaPayload) => Promise<void>;
}

export function EntitySchemaCreateModal(props: EntitySchemaCreateModalProps) {
	const entitySchemaForm = useCreateEntitySchemaForm({
		trackerId: props.trackerId,
		onSubmit: props.onSubmit,
	});

	return (
		<Modal
			centered
			size="lg"
			title="Add schema"
			opened={props.opened}
			onClose={props.onClose}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form onSubmit={createFormSubmitHandler(entitySchemaForm.handleSubmit)}>
				<entitySchemaForm.AppForm>
					<Stack gap="md">
						<FormError message={props.errorMessage} />

						<entitySchemaForm.AppField name="name" listeners={entitySchemaForm.nameFieldListeners}>
							{(field) => (
								<field.TextField
									required
									label="Name"
									disabled={props.isLoading}
									placeholder="Custom schema"
								/>
							)}
						</entitySchemaForm.AppField>

						<entitySchemaForm.AppField name="slug">
							{(field) => (
								<field.TextField
									label="Slug"
									disabled={props.isLoading}
									placeholder="custom-schema"
								/>
							)}
						</entitySchemaForm.AppField>

						<Group grow align="flex-start" wrap="nowrap">
							<entitySchemaForm.AppField name="icon">
								{(field) => (
									<field.SelectField
										required
										searchable
										limit={100}
										label="Icon"
										placeholder="Select icon"
										disabled={props.isLoading}
										data={trackerIconSelectData}
										leftSection={<TrackerIcon icon={field.state.value} />}
										renderOption={({ option }) => (
											<Group gap={8} wrap="nowrap">
												<TrackerIcon icon={option.value} />
												<span>{option.label}</span>
											</Group>
										)}
									/>
								)}
							</entitySchemaForm.AppField>

							<entitySchemaForm.AppField name="accentColor">
								{(field) => (
									<field.ColorInputField
										required
										label="Accent Color"
										disabled={props.isLoading}
										placeholder="Choose color"
									/>
								)}
							</entitySchemaForm.AppField>
						</Group>

						<EntitySchemaPropertiesBuilder form={entitySchemaForm} isLoading={props.isLoading} />

						<Group justify="flex-end" gap="md">
							<Button
								type="button"
								variant="subtle"
								onClick={props.onClose}
								disabled={props.isLoading}
							>
								Cancel
							</Button>
							<entitySchemaForm.SubmitButton
								label="Create schema"
								disabled={props.isLoading}
								pendingLabel="Creating..."
							/>
						</Group>
					</Stack>
				</entitySchemaForm.AppForm>
			</form>
		</Modal>
	);
}
