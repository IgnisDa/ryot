import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { AppSchema } from "@ryot/ts-utils";
import { z } from "zod";
import {
	buildPropertiesSchema,
	type PropertySchemaRow,
	propertySchemaTypes,
} from "#/features/property-schemas/form";
import { PropertySchemasBuilder } from "#/features/property-schemas/properties-builder";
import { useAppForm } from "#/hooks/forms";

const collectionPropertyRowSchema = z.object({
	id: z.string(),
	key: z.string(),
	required: z.boolean(),
	type: z.enum(propertySchemaTypes),
	label: z.string().min(1, "Label is required"),
});

const createCollectionFormSchema = z.object({
	properties: z.array(collectionPropertyRowSchema),
	name: z.string().min(1, "Name is required"),
});

export type CreateCollectionFormPayload = {
	name: string;
	membershipPropertiesSchema?: AppSchema;
};

function useCreateCollectionForm(props: {
	onSubmit: (payload: CreateCollectionFormPayload) => Promise<void>;
}) {
	return useAppForm({
		validators: { onChange: createCollectionFormSchema as never },
		defaultValues: { name: "", properties: [] as PropertySchemaRow[] },
		onSubmit: async ({ value }) => {
			const membershipPropertiesSchema =
				value.properties.length > 0
					? buildPropertiesSchema(value.properties)
					: undefined;
			await props.onSubmit({ name: value.name, membershipPropertiesSchema });
		},
	});
}

export function CreateCollectionModal(props: {
	opened: boolean;
	onClose: () => void;
	isSubmitting: boolean;
	errorMessage: string | null;
	onSubmit: (payload: CreateCollectionFormPayload) => Promise<void>;
}) {
	const form = useCreateCollectionForm({ onSubmit: props.onSubmit });

	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			title="New collection"
			onClose={props.onClose}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.AppForm>
					<Stack gap="md">
						{props.errorMessage ? (
							<Text c="red" size="sm">
								{props.errorMessage}
							</Text>
						) : null}
						<form.AppField name="name">
							{(field) => (
								<field.TextField
									required
									label="Name"
									disabled={props.isSubmitting}
									placeholder="My collection"
								/>
							)}
						</form.AppField>
						<PropertySchemasBuilder
							form={form}
							isLoading={props.isSubmitting}
							placeholder="fieldName"
							description="Define what information is required when adding an item to this collection. Leave empty for no required metadata."
						/>
						<Group justify="flex-end" gap="md">
							<Button
								type="button"
								variant="subtle"
								onClick={props.onClose}
								disabled={props.isSubmitting}
							>
								Cancel
							</Button>
							<form.SubmitButton
								label="Create"
								disabled={props.isSubmitting}
								pendingLabel="Creating..."
							/>
						</Group>
					</Stack>
				</form.AppForm>
			</form>
		</Modal>
	);
}
