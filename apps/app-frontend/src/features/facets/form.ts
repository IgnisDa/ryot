import {
	trimmedOrNull,
	trimmedOrUndefined,
	zodRequiredName,
	zodRequiredSlug,
} from "@ryot/ts-utils";
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
	name: zodRequiredName,
	slug: zodRequiredSlug,
	description: z.string(),
	accentColor: z.string(),
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

	const icon = trimmedOrUndefined(input.icon);
	if (icon !== undefined) payload.icon = icon;

	const description = trimmedOrUndefined(input.description);
	if (description !== undefined) payload.description = description;

	const accentColor = trimmedOrUndefined(input.accentColor);
	if (accentColor !== undefined) payload.accentColor = accentColor;

	return payload;
}

export function toUpdateFacetPayload(
	input: CreateFacetFormValues,
): UpdateFacetPayload {
	return {
		name: input.name.trim(),
		slug: input.slug.trim(),
		icon: input.icon !== undefined ? trimmedOrNull(input.icon) : undefined,
		description:
			input.description !== undefined
				? trimmedOrNull(input.description)
				: undefined,
		accentColor:
			input.accentColor !== undefined
				? trimmedOrNull(input.accentColor)
				: undefined,
	};
}
