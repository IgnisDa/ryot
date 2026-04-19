import { Button, Group, Modal, Stack } from "@mantine/core";
import { FormError } from "~/components/PageStates";
import type { PropertySchemaRow } from "~/features/property-schemas/form";
import { PropertySchemasBuilder } from "~/features/property-schemas/properties-builder";
import { createFormSubmitHandler, useAppForm } from "~/hooks/forms";
import {
	type CreateCollectionPayload,
	createCollectionFormSchema,
	toCreateCollectionPayload,
} from "./form";

export type CreateCollectionFormPayload = CreateCollectionPayload;

function useCreateCollectionForm(props: {
	onSubmit: (payload: CreateCollectionFormPayload) => Promise<void>;
}) {
	return useAppForm({
		validators: { onChange: createCollectionFormSchema as never },
		defaultValues: { name: "", properties: [] as PropertySchemaRow[] },
		onSubmit: async ({ value }) => {
			await props.onSubmit(toCreateCollectionPayload(value));
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
			<form onSubmit={createFormSubmitHandler(form.handleSubmit)}>
				<form.AppForm>
					<Stack gap="md">
						<FormError message={props.errorMessage} />
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
