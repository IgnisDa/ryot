import { Button, Group, Stack } from "@mantine/core";
import type { SidebarTracker } from "#/components/sidebar/Sidebar.types";
import { TrackerIcon, trackerIconSelectData } from "#/features/trackers/icons";
import { useAppForm } from "#/hooks/forms";
import {
	buildSavedViewFormValues,
	type SavedViewFormValues,
	savedViewFormSchema,
} from "../form";
import type { AppSavedView } from "../model";

export function SavedViewForm(props: {
	view: AppSavedView;
	onCancel: () => void;
	isSubmitting: boolean;
	trackers: SidebarTracker[];
	onSubmit: (values: SavedViewFormValues) => Promise<void>;
}) {
	const trackerSelectData = [
		{ value: "", label: "None (standalone)" },
		...props.trackers.map((t) => ({ value: t.id, label: t.name })),
	];

	const form = useAppForm({
		validators: { onChange: savedViewFormSchema },
		defaultValues: buildSavedViewFormValues({
			name: props.view.name,
			icon: props.view.icon,
			trackerId: props.view.trackerId,
			accentColor: props.view.accentColor,
		}),
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
					<form.AppField name="name">
						{(field) => (
							<field.TextField
								required
								label="Name"
								disabled={props.isSubmitting}
								placeholder="Enter view name"
							/>
						)}
					</form.AppField>

					<Group grow align="flex-start" wrap="nowrap">
						<form.AppField name="icon">
							{(field) => (
								<field.SelectField
									required
									searchable
									limit={100}
									label="Icon"
									placeholder="Select icon"
									data={trackerIconSelectData}
									disabled={props.isSubmitting}
									leftSection={<TrackerIcon icon={field.state.value} />}
									renderOption={({ option }) => (
										<Group gap={8} wrap="nowrap">
											<TrackerIcon icon={option.value} />
											<span>{option.label}</span>
										</Group>
									)}
								/>
							)}
						</form.AppField>

						<form.AppField name="accentColor">
							{(field) => (
								<field.ColorInputField
									required
									label="Accent Color"
									placeholder="Choose color"
									disabled={props.isSubmitting}
								/>
							)}
						</form.AppField>
					</Group>

					<form.AppField name="trackerId">
						{(field) => (
							<field.SelectField
								clearable
								label="Tracker"
								data={trackerSelectData}
								disabled={props.isSubmitting}
								placeholder="None (standalone)"
								value={field.state.value || null}
								onChange={(value) =>
									field.handleChange((value ?? "") as string)
								}
							/>
						)}
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
							label="Update"
							pendingLabel="Saving..."
							disabled={props.isSubmitting}
						/>
					</Group>
				</Stack>
			</form.AppForm>
		</form>
	);
}
