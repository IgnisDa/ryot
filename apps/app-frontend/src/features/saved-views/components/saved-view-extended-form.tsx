import { Button, Group, MultiSelect, Stack, Text } from "@mantine/core";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import { useAppForm } from "#/hooks/forms";
import {
	buildSavedViewExtendedFormValues,
	type SavedViewExtendedFormValues,
	savedViewExtendedFormSchema,
} from "../form-extended";
import type { AppSavedView } from "../model";

export function SavedViewExtendedForm(props: {
	view: AppSavedView;
	onCancel: () => void;
	isSubmitting: boolean;
	onSubmit: (values: SavedViewExtendedFormValues) => Promise<void>;
}) {
	// Fetch entity schemas for the view's tracker
	const trackerId = props.view.trackerId ?? "";
	const { entitySchemas } = useEntitySchemasQuery(trackerId, trackerId !== "");

	const entitySchemaSelectData = entitySchemas.map((schema) => ({
		value: schema.slug,
		label: schema.name,
	}));

	const form = useAppForm({
		validators: { onChange: savedViewExtendedFormSchema },
		defaultValues: buildSavedViewExtendedFormValues(props.view),
		onSubmit: async ({ value }) => {
			await props.onSubmit(value);
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.AppForm>
				<Stack gap="md">
					<Text size="sm" c="dimmed">
						Edit query definition and display configuration for this view.
					</Text>

					<form.AppField name="entitySchemaSlugs" mode="array">
						{(field) => {
							const value = field.state.value as string[];
							const errorMessage =
								field.state.meta.errors.length > 0
									? field.state.meta.errors.map((e) => e?.message).join(", ")
									: undefined;
							return (
								<MultiSelect
									required
									searchable
									value={value}
									error={errorMessage}
									label="Entity Schemas"
									data={entitySchemaSelectData}
									disabled={props.isSubmitting}
									placeholder="Select entity schemas to query"
									description="Choose which entity types this view should display"
									onChange={(newValue) => {
										field.handleChange(newValue);
									}}
								/>
							);
						}}
					</form.AppField>

					<Group gap="md" justify="flex-end">
						<Button
							type="button"
							variant="subtle"
							onClick={props.onCancel}
							disabled={props.isSubmitting}
						>
							Cancel
						</Button>
						<form.SubmitButton
							label="Save Changes"
							pendingLabel="Saving..."
							disabled={props.isSubmitting}
						/>
					</Group>
				</Stack>
			</form.AppForm>
		</form>
	);
}
