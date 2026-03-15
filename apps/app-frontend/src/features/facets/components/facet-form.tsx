import {
	Button,
	ColorInput,
	Group,
	Select,
	Stack,
	Textarea,
} from "@mantine/core";
import { useAppForm } from "#/hooks/forms";
import {
	buildFacetFormValues,
	createFacetFormSchema,
	toCreateFacetPayload,
	toUpdateFacetPayload,
} from "../form";
import { FacetIcon, facetIconSelectData, getFacetIconOption } from "../icons";
import {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "../sidebar-context";
import { getFacetToggleUi } from "./facet-form-ui";

export function FacetForm() {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const activeFacet = state.activeFacet;
	const isLoading = state.isModalSubmitting;
	const isCreateMode = activeFacet === undefined;
	const toggleUi = getFacetToggleUi(activeFacet);
	const facetForm = useAppForm({
		validators: { onChange: createFacetFormSchema },
		defaultValues: buildFacetFormValues({
			name: activeFacet?.name,
			slug: activeFacet?.slug,
			icon: activeFacet?.icon ?? "",
			description: activeFacet?.description ?? "",
			accentColor: activeFacet?.accentColor ?? "",
		}),
		onSubmit: async ({ value }) => {
			if (isCreateMode) {
				await actions.submitModal(toCreateFacetPayload(value));
				return;
			}
			await actions.submitModal(toUpdateFacetPayload(value));
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void facetForm.handleSubmit();
			}}
		>
			<facetForm.AppForm>
				<Stack gap="md">
					<facetForm.AppField name="name">
						{(field) => (
							<field.TextField
								required
								label="Name"
								disabled={isLoading}
								placeholder="Enter facet name"
							/>
						)}
					</facetForm.AppField>

					<facetForm.AppField name="slug">
						{(field) => (
							<field.TextField
								required
								label="Slug"
								disabled={isLoading}
								placeholder="enter-facet-slug"
							/>
						)}
					</facetForm.AppField>

					<Group grow align="flex-start" wrap="nowrap">
						<facetForm.AppField name="icon">
							{(field) => (
								<Select
									clearable
									searchable
									label="Icon"
									data={facetIconSelectData}
									disabled={isLoading}
									value={field.state.value || null}
									placeholder="Select icon"
									leftSection={<FacetIcon icon={field.state.value} />}
									onBlur={field.handleBlur}
									onChange={(value) => field.handleChange(value ?? "")}
									renderOption={({ option }) => {
										const iconOption = getFacetIconOption(option.value);
										const OptionIcon = iconOption?.icon;

										return (
											<Group gap={8} wrap="nowrap">
												{!OptionIcon ? undefined : (
													<OptionIcon size={16} strokeWidth={1.8} />
												)}
												<span>{option.label}</span>
											</Group>
										);
									}}
								/>
							)}
						</facetForm.AppField>

						<facetForm.AppField name="accentColor">
							{(field) => (
								<ColorInput
									label="Accent Color"
									disabled={isLoading}
									value={field.state.value}
									placeholder="Choose color"
									onChange={(value) => field.handleChange(value)}
								/>
							)}
						</facetForm.AppField>
					</Group>

					<facetForm.AppField name="description">
						{(field) => (
							<Textarea
								rows={3}
								label="Description"
								disabled={isLoading}
								onBlur={field.handleBlur}
								value={field.state.value}
								placeholder="Facet description (optional)"
								onChange={(event) =>
									field.handleChange(event.currentTarget.value)
								}
							/>
						)}
					</facetForm.AppField>

					<Group
						gap="md"
						justify={toggleUi.visible ? "space-between" : "flex-end"}
					>
						{!toggleUi.visible ? undefined : (
							<Button
								size="sm"
								disabled={isLoading}
								color={toggleUi.color}
								variant={toggleUi.variant}
								loading={state.isDisablePending}
								onClick={() => void actions.toggleActiveFacet()}
							>
								{toggleUi.label}
							</Button>
						)}

						<Group gap="md">
							<Button
								type="button"
								variant="subtle"
								disabled={isLoading}
								onClick={actions.closeModal}
							>
								Cancel
							</Button>
							<facetForm.SubmitButton
								disabled={isLoading}
								pendingLabel="Saving..."
								label={isCreateMode ? "Create" : "Update"}
							/>
						</Group>
					</Group>
				</Stack>
			</facetForm.AppForm>
		</form>
	);
}
