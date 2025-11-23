import {
	trimmedOrNull,
	trimmedOrUndefined,
	zodNonEmptyTrimmedString,
	zodRequiredName,
	zodRequiredSlug,
} from "@ryot/ts-utils";
import { z } from "zod";
import type { ApiPatchRequestBody, ApiPostRequestBody } from "#/lib/api/types";
import { resolveNextSlug } from "../../lib/slug-sync";

export const createTrackerFormSchema = z.object({
	name: zodRequiredName,
	slug: zodRequiredSlug,
	description: z.string(),
	accentColor: zodNonEmptyTrimmedString("Accent color is required"),
	icon: zodNonEmptyTrimmedString("Icon is required"),
});

export type CreateTrackerFormValues = z.infer<typeof createTrackerFormSchema>;

export function buildTrackerFormValues(
	values?: Partial<CreateTrackerFormValues>,
): CreateTrackerFormValues {
	return {
		name: values?.name ?? "",
		slug: values?.slug ?? "",
		icon: values?.icon ?? "",
		description: values?.description ?? "",
		accentColor: values?.accentColor ?? "",
	};
}

export const defaultCreateTrackerFormValues: CreateTrackerFormValues =
	buildTrackerFormValues();

export const resolveNextTrackerSlug = resolveNextSlug;

export type CreateTrackerPayload = ApiPostRequestBody<"/trackers">;

export type UpdateTrackerPayload = ApiPatchRequestBody<"/trackers/{trackerId}">;

export function toCreateTrackerPayload(
	input: CreateTrackerFormValues,
): CreateTrackerPayload {
	const payload: CreateTrackerPayload = {
		icon: input.icon.trim(),
		name: input.name.trim(),
		slug: input.slug.trim(),
		accentColor: input.accentColor.trim(),
	};

	const description = trimmedOrUndefined(input.description);
	if (description !== undefined) payload.description = description;

	return payload;
}

export function toUpdateTrackerPayload(
	input: CreateTrackerFormValues,
): UpdateTrackerPayload {
	return {
		icon: input.icon.trim(),
		name: input.name.trim(),
		slug: input.slug.trim(),
		accentColor: input.accentColor.trim(),
		description:
			input.description !== undefined
				? trimmedOrNull(input.description)
				: undefined,
	};
}
