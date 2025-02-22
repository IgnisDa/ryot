import {
	Button,
	ColorInput,
	Group,
	Select,
	Stack,
	Textarea,
} from "@mantine/core";
import { useEffect, useRef } from "react";
import { useAppForm } from "#/hooks/forms";
import { createNameFieldListeners } from "#/lib/slug-sync";
import {
	buildTrackerFormValues,
	createTrackerFormSchema,
	resolveNextTrackerSlug,
	toCreateTrackerPayload,
	toUpdateTrackerPayload,
} from "../form";
import { TrackerIcon, trackerIconSelectData } from "../icons";
import {
	useTrackerSidebarActions,
	useTrackerSidebarState,
} from "../sidebar-context";

export function TrackerForm() {
	const state = useTrackerSidebarState();
	const actions = useTrackerSidebarActions();
	const activeTracker = state.activeTracker;
	const isLoading = state.isModalSubmitting;
	const isCreateMode = activeTracker === undefined;
	const previousDerivedSlug = useRef(
		resolveNextTrackerSlug({
			slug: "",
			name: activeTracker?.name ?? "",
		}),
	);
	const trackerForm = useAppForm({
		validators: { onChange: createTrackerFormSchema },
		defaultValues: buildTrackerFormValues({
			name: activeTracker?.name,
			slug: activeTracker?.slug,
			icon: activeTracker?.icon ?? "",
			description: activeTracker?.description ?? "",
			accentColor: activeTracker?.accentColor ?? "",
		}),
		onSubmit: async ({ value }) => {
			if (isCreateMode) {
				await actions.submitModal(toCreateTrackerPayload(value));
				return;
			}
			await actions.submitModal(toUpdateTrackerPayload(value));
		},
	});

	useEffect(() => {
		previousDerivedSlug.current = resolveNextTrackerSlug({
			slug: "",
			name: activeTracker?.name ?? "",
		});
	}, [activeTracker?.name]);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void trackerForm.handleSubmit();
			}}
		>
			<trackerForm.AppForm>
				<Stack gap="md">
					<trackerForm.AppField
						name="name"
						listeners={createNameFieldListeners({
							form: trackerForm,
							previousDerivedSlug,
						})}
					>
						{(field) => (
							<field.TextField
								required
								label="Name"
								disabled={isLoading}
								placeholder="Enter tracker name"
							/>
						)}
					</trackerForm.AppField>

					<trackerForm.AppField name="slug">
						{(field) => (
							<field.TextField
								required
								label="Slug"
								disabled={isLoading}
								placeholder="enter-tracker-slug"
							/>
						)}
					</trackerForm.AppField>

					<Group grow align="flex-start" wrap="nowrap">
						<trackerForm.AppField name="icon">
							{(field) => (
								<Select
									required
									searchable
									limit={100}
									label="Icon"
									disabled={isLoading}
									placeholder="Select icon"
									onBlur={field.handleBlur}
									data={trackerIconSelectData}
									value={field.state.value || null}
									leftSection={<TrackerIcon icon={field.state.value} />}
									onChange={(value) => field.handleChange(value ?? "")}
									renderOption={({ option }) => (
										<Group gap={8} wrap="nowrap">
											<TrackerIcon icon={option.value} />
											<span>{option.label}</span>
										</Group>
									)}
								/>
							)}
						</trackerForm.AppField>

						<trackerForm.AppField name="accentColor">
							{(field) => (
								<ColorInput
									required
									label="Accent Color"
									disabled={isLoading}
									value={field.state.value}
									placeholder="Choose color"
									onChange={(value) => field.handleChange(value)}
								/>
							)}
						</trackerForm.AppField>
					</Group>

					<trackerForm.AppField name="description">
						{(field) => (
							<Textarea
								rows={3}
								label="Description"
								disabled={isLoading}
								onBlur={field.handleBlur}
								value={field.state.value}
								placeholder="Tracker description (optional)"
								onChange={(event) =>
									field.handleChange(event.currentTarget.value)
								}
							/>
						)}
					</trackerForm.AppField>

					<Group gap="md" justify="flex-end">
						<Button
							type="button"
							variant="subtle"
							disabled={isLoading}
							onClick={actions.closeModal}
						>
							Cancel
						</Button>
						<trackerForm.SubmitButton
							disabled={isLoading}
							pendingLabel="Saving..."
							label={isCreateMode ? "Create" : "Update"}
						/>
					</Group>
				</Stack>
			</trackerForm.AppForm>
		</form>
	);
}
