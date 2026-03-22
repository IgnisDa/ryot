import { Button, Group, Stack, Text } from "@mantine/core";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import { useAppForm } from "#/hooks/forms";
import {
	buildSavedViewExtendedFormValues,
	type SavedViewExtendedFormValues,
	savedViewExtendedFormSchema,
} from "../form-extended";
import type { AppSavedView } from "../model";
import { FiltersBuilder } from "./filters-builder";
import { GridConfigBuilder } from "./grid-config-builder";
import { SortBuilder } from "./sort-builder";

export function SavedViewExtendedForm(props: {
	view: AppSavedView;
	onCancel: () => void;
	isSubmitting: boolean;
	onSubmit: (values: SavedViewExtendedFormValues) => Promise<void>;
}) {
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
						{(field) => (
							<field.MultiSelectField
								required
								searchable
								label="Entity Schemas"
								data={entitySchemaSelectData}
								disabled={props.isSubmitting}
								placeholder="Select entity schemas to query"
								description="Choose which entity types this view should display"
							/>
						)}
					</form.AppField>

					<SortBuilder form={form} isLoading={props.isSubmitting} />

					<FiltersBuilder form={form} isLoading={props.isSubmitting} />

					<GridConfigBuilder form={form} isLoading={props.isSubmitting} />

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
