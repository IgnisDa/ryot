import { zodNonEmptyTrimmedString, zodRequiredName } from "@ryot/ts-utils";
import { z } from "zod";

export const savedViewFormSchema = z.object({
	trackerId: z.string(),
	name: zodRequiredName,
	icon: zodNonEmptyTrimmedString("Icon is required"),
	accentColor: zodNonEmptyTrimmedString("Accent color is required"),
});

export type SavedViewFormValues = z.infer<typeof savedViewFormSchema>;

export function buildSavedViewFormValues(values?: {
	name?: string;
	icon?: string;
	accentColor?: string;
	trackerId?: string | null;
}): SavedViewFormValues {
	return {
		name: values?.name ?? "",
		icon: values?.icon ?? "",
		trackerId: values?.trackerId ?? "",
		accentColor: values?.accentColor ?? "",
	};
}
