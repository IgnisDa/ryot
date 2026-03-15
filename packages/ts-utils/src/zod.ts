import { z } from "zod";

export const zodBoolAsString = z
	.string()
	.regex(/^(true|false)$/, 'Must be a boolean string ("true" or "false")')
	.transform((value) => value === "true");

export const zodCheckboxAsString = z
	.literal("on")
	.optional()
	.transform((value) => value === "on");

export const zodIntAsString = z
	.string()
	.regex(/^-?\d+$/, "Must be an integer string")
	.transform((val) => Number.parseInt(val, 10));

export const zodNumAsString = z
	.string()
	.regex(/^-?\d*\.?\d+$/, "Must be a number string")
	.transform(Number);

export const zodNonEmptyTrimmedString = (errorMessage: string) =>
	z.string().trim().min(1, errorMessage);

export const zodRequiredName = zodNonEmptyTrimmedString("Name is required");

export const zodRequiredSlug = zodNonEmptyTrimmedString("Slug is required");
