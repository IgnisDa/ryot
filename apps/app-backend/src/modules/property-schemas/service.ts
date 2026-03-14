import type { AppSchema } from "@ryot/ts-utils";
import { createPropertySchemaObjectSchema } from "./schemas";

type PropertySchemaLabels = {
	propertiesLabel: string;
};

export const parsePropertySchemaInput = (
	input: unknown,
	labels: PropertySchemaLabels,
): AppSchema => {
	const schema = createPropertySchemaObjectSchema(
		`${labels.propertiesLabel} must contain at least one property`,
	);
	const parsedObject = schema.safeParse(input);
	if (parsedObject.success) return parsedObject.data;

	const firstIssue = parsedObject.error.issues[0];
	if (!firstIssue) throw new Error("Property schema is invalid");

	throw new Error(firstIssue.message);
};

export const parseLabeledPropertySchemaInput = (
	input: unknown,
	propertiesLabel: string,
) => parsePropertySchemaInput(input, { propertiesLabel });
