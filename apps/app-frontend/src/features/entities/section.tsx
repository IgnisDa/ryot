import { Button, Group, Modal, Stack } from "@mantine/core";
import { FormError } from "~/components/PageStates";
import type { AppEntitySchema } from "~/features/entity-schemas/model";
import { GeneratedPropertyField } from "~/features/generated-property-fields";
import { createFormSubmitHandler } from "~/hooks/forms";
import type { CreateEntityPayload } from "./form";
import { useCreateEntityForm } from "./use-form";

export function CreateEntityModal(props: {
	opened: boolean;
	isLoading: boolean;
	onClose: () => void;
	errorMessage: string | null;
	entitySchema: AppEntitySchema;
	onSubmit: (payload: CreateEntityPayload) => Promise<void>;
}) {
	const entityForm = useCreateEntityForm({
		onSubmit: props.onSubmit,
		entitySchemaId: props.entitySchema.id,
		propertiesSchema: props.entitySchema.propertiesSchema,
	});

	const propertyFields = Object.entries(
		props.entitySchema.propertiesSchema.fields,
	).map(([propertyKey, propertyDef]) => (
		<GeneratedPropertyField
			form={entityForm}
			key={propertyKey}
			propertyKey={propertyKey}
			propertyDef={propertyDef}
			disabled={props.isLoading}
			options={{ fallback: "text" }}
		/>
	));

	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			onClose={props.onClose}
			title={`Add ${props.entitySchema.name}`}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form onSubmit={createFormSubmitHandler(entityForm.handleSubmit)}>
				<entityForm.AppForm>
					<Stack gap="md">
						<FormError message={props.errorMessage} />

						<entityForm.AppField name="name">
							{(field) => (
								<field.TextField
									required
									label="Name"
									disabled={props.isLoading}
									placeholder={`Enter ${props.entitySchema.name.toLowerCase()} name`}
								/>
							)}
						</entityForm.AppField>

						<entityForm.AppField name="image">
							{(field) => (
								<field.ImageField label="Image" disabled={props.isLoading} />
							)}
						</entityForm.AppField>

						{propertyFields}

						<Group justify="flex-end" gap="md">
							<Button
								type="button"
								variant="subtle"
								onClick={props.onClose}
								disabled={props.isLoading}
							>
								Cancel
							</Button>
							<entityForm.SubmitButton
								disabled={props.isLoading}
								pendingLabel="Creating..."
								label={`Create ${props.entitySchema.name.toLowerCase()}`}
							/>
						</Group>
					</Stack>
				</entityForm.AppForm>
			</form>
		</Modal>
	);
}
