import {
	trimmedOrNull,
	trimmedOrUndefined,
	zodNonEmptyTrimmedString,
	zodRequiredName,
	zodRequiredSlug,
} from "@ryot/ts-utils";
import { z } from "zod";
import {
	type ResolveNextSlugInput,
	resolveNextSlug,
} from "../../lib/slug-sync";

export interface FacetFormValues {
	name: string;
	slug: string;
	icon: string;
	description: string;
	accentColor: string;
}

export type ResolveNextFacetSlugInput = ResolveNextSlugInput;

export const createFacetFormSchema = z.object({
	name: zodRequiredName,
	slug: zodRequiredSlug,
	description: z.string(),
	accentColor: z.string(),
	icon: zodNonEmptyTrimmedString("Icon is required"),
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

export const resolveNextFacetSlug = resolveNextSlug;

export interface CreateFacetPayload {
	icon: string;
	name: string;
	slug: string;
	description?: string;
	accentColor?: string;
}

export interface UpdateFacetPayload {
	icon: string;
	name: string;
	slug: string;
	description?: string | null;
	accentColor?: string | null;
}

export function toCreateFacetPayload(
	input: CreateFacetFormValues,
): CreateFacetPayload {
	const payload: CreateFacetPayload = {
		icon: input.icon.trim(),
		name: input.name.trim(),
		slug: input.slug.trim(),
	};

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
		icon: input.icon.trim(),
		name: input.name.trim(),
		slug: input.slug.trim(),
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
