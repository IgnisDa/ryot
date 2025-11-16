import {
	Button,
	ColorInput,
	Group,
	Modal,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import type { CreateEntitySchemaPayload } from "#/features/entity-schemas/form";
import { EntitySchemaPropertiesBuilder } from "#/features/entity-schemas/properties-builder";
import { useCreateEntitySchemaForm } from "#/features/entity-schemas/use-form";
import { FacetIcon, facetIconSelectData } from "#/features/facets/icons";

export interface EntitySchemaCreateModalProps {
	opened: boolean;
	facetId: string;
	isLoading: boolean;
	onClose: () => void;
	errorMessage: string | null;
	onSubmit: (payload: CreateEntitySchemaPayload) => Promise<void>;
}

export function EntitySchemaCreateModal(props: EntitySchemaCreateModalProps) {
	const entitySchemaForm = useCreateEntitySchemaForm({
		facetId: props.facetId,
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
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void entitySchemaForm.handleSubmit();
				}}
			>
				<entitySchemaForm.AppForm>
					<Stack gap="md">
						{props.errorMessage && (
							<Text c="red" size="sm">
								{props.errorMessage}
							</Text>
						)}

						<entitySchemaForm.AppField
							name="name"
							listeners={entitySchemaForm.nameFieldListeners}
						>
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
									<Select
										required
										searchable
										limit={100}
										label="Icon"
										placeholder="Select icon"
										onBlur={field.handleBlur}
										disabled={props.isLoading}
										data={facetIconSelectData}
										value={field.state.value || null}
										leftSection={<FacetIcon icon={field.state.value} />}
										onChange={(value) => field.handleChange(value ?? "")}
										renderOption={({ option }) => (
											<Group gap={8} wrap="nowrap">
												<FacetIcon icon={option.value} />
												<span>{option.label}</span>
											</Group>
										)}
									/>
								)}
							</entitySchemaForm.AppField>

							<entitySchemaForm.AppField name="accentColor">
								{(field) => (
									<ColorInput
										required
										label="Accent Color"
										value={field.state.value}
										disabled={props.isLoading}
										placeholder="Choose color"
										onChange={(value) => field.handleChange(value)}
									/>
								)}
							</entitySchemaForm.AppField>
						</Group>

						<EntitySchemaPropertiesBuilder
							form={entitySchemaForm}
							isLoading={props.isLoading}
						/>

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
