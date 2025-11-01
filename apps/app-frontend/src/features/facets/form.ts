import { z } from "zod";

export interface FacetFormValues {
	name: string;
	slug: string;
	icon: string;
	description: string;
	accentColor: string;
}

export const createFacetFormSchema = z.object({
	icon: z.string(),
	accentColor: z.string(),
	description: z.string(),
	name: z
		.string()
		.refine((value) => value.trim().length > 0, "Name is required"),
	slug: z
		.string()
		.refine((value) => value.trim().length > 0, "Slug is required"),
});

export type CreateFacetFormValues = z.infer<typeof createFacetFormSchema>;

export function buildFacetFormValues(
	values?: Partial<FacetFormValues>,
): CreateFacetFormValues {
	return {
		name: values?.name ?? "",
		slug: values?.slug ?? "",
		icon: values?.icon ?? "",
		description: values?.description ?? "",
		accentColor: values?.accentColor ?? "",
	};
}

export const defaultCreateFacetFormValues: CreateFacetFormValues =
	buildFacetFormValues();

export interface CreateFacetPayload {
	name: string;
	slug: string;
	icon?: string;
	description?: string;
	accentColor?: string;
}

export interface UpdateFacetPayload {
	name: string;
	slug: string;
	icon?: string | null;
	description?: string | null;
	accentColor?: string | null;
}

export function toCreateFacetPayload(
	input: CreateFacetFormValues,
): CreateFacetPayload {
	const payload: CreateFacetPayload = {
		name: input.name.trim(),
		slug: input.slug.trim(),
	};

	if (input.icon) payload.icon = input.icon.trim();

	if (input.description) payload.description = input.description.trim();

	if (input.accentColor) payload.accentColor = input.accentColor.trim();

	return payload;
}

export function toUpdateFacetPayload(
	input: CreateFacetFormValues,
): UpdateFacetPayload {
	const payload: UpdateFacetPayload = {
		name: input.name.trim(),
		slug: input.slug.trim(),
	};

	if (input.icon !== undefined) {
		const trimmed = input.icon.trim();
		payload.icon = trimmed === "" ? null : trimmed;
	}

	if (input.description !== undefined) {
		const trimmed = input.description.trim();
		payload.description = trimmed === "" ? null : trimmed;
	}

	if (input.accentColor !== undefined) {
		const trimmed = input.accentColor.trim();
		payload.accentColor = trimmed === "" ? null : trimmed;
	}

	return payload;
}
