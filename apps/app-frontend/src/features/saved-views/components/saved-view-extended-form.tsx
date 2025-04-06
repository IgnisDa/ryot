import { Button, Divider, Group, Stack, Text } from "@mantine/core";
import { useStore } from "@tanstack/react-form";
import { useState } from "react";
import {
	useEntitySchemasBySlugQuery,
	useEntitySchemasQuery,
} from "#/features/entity-schemas/hooks";
import { useAppForm } from "#/hooks/forms";
import { getErrorMessage } from "#/lib/errors";
import {
	buildSavedViewExtendedFormValues,
	type SavedViewExtendedFormValues,
	savedViewExtendedFormSchema,
} from "../form-extended";
import type { AppSavedView } from "../model";
import { DisplayConfigBuilder } from "./display-config-builder";
import { FiltersBuilder } from "./filters-builder";
import { SortBuilder } from "./sort-builder";

export function SavedViewExtendedForm(props: {
	view: AppSavedView;
	onCancel: () => void;
	isSubmitting: boolean;
	onSubmit: (values: SavedViewExtendedFormValues) => Promise<void>;
}) {
	const [submitError, setSubmitError] = useState<string | null>(null);
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
			setSubmitError(null);
			try {
				await props.onSubmit(value);
			} catch (error) {
				setSubmitError(getErrorMessage(error, "Failed to save view changes."));
			}
		},
	});

	const entitySchemaSlugs = useStore(
		form.store,
		(state) => state.values.entitySchemaSlugs,
	);
	const { entitySchemas: schemas } =
		useEntitySchemasBySlugQuery(entitySchemaSlugs);

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
					<Stack gap={2}>
						<Text size="sm" c="dimmed">
							Edit query definition and display configuration for this view.
						</Text>
					</Stack>

					{submitError ? (
						<Text size="sm" c="red">
							{submitError}
						</Text>
					) : null}

					<Divider label="Query Definition" labelPosition="left" />

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

					<SortBuilder
						form={form}
						schemas={schemas}
						isLoading={props.isSubmitting}
					/>

					<FiltersBuilder
						form={form}
						schemas={schemas}
						isLoading={props.isSubmitting}
						setFieldValue={(name, value) =>
							// biome-ignore lint/suspicious/noExplicitAny: form.setFieldValue strict generics require cast for dynamic field names
							form.setFieldValue(name as any, value)
						}
					/>

					<Divider label="Display Configuration" labelPosition="left" />

					<DisplayConfigBuilder
						form={form}
						schemas={schemas}
						isLoading={props.isSubmitting}
					/>

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
