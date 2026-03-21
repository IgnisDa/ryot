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
	buildFacetFormValues,
	createFacetFormSchema,
	resolveNextFacetSlug,
	toCreateFacetPayload,
	toUpdateFacetPayload,
} from "../form";
import { FacetIcon, facetIconSelectData } from "../icons";
import {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "../sidebar-context";

export function FacetForm() {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const activeFacet = state.activeFacet;
	const isLoading = state.isModalSubmitting;
	const isCreateMode = activeFacet === undefined;
	const previousDerivedSlug = useRef(
		resolveNextFacetSlug({
			slug: "",
			name: activeFacet?.name ?? "",
		}),
	);
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

	useEffect(() => {
		previousDerivedSlug.current = resolveNextFacetSlug({
			slug: "",
			name: activeFacet?.name ?? "",
		});
	}, [activeFacet?.name]);

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
					<facetForm.AppField
						name="name"
						listeners={createNameFieldListeners({
							form: facetForm,
							previousDerivedSlug,
						})}
					>
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
									required
									searchable
									limit={100}
									label="Icon"
									disabled={isLoading}
									placeholder="Select icon"
									onBlur={field.handleBlur}
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

					<Group gap="md" justify="flex-end">
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
				</Stack>
			</facetForm.AppForm>
		</form>
	);
}
