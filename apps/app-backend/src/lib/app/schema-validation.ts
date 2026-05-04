import type { AppSchema } from "@ryot/ts-utils";
import { fromAppSchemaObject } from "@ryot/ts-utils";

export type ValidationIssue = {
	path: string;
	message: string;
};

export type ValidationResult =
	| { success: true; data: Record<string, unknown> }
	| { success: false; issues: ValidationIssue[] };

export const parseAppSchemaProperties = (input: {
	kind: string;
	properties: unknown;
	propertiesSchema: AppSchema;
}): Record<string, unknown> => {
	if (!input.properties || typeof input.properties !== "object") {
		throw new Error(`${input.kind} properties must be a JSON object`);
	}

	if (Array.isArray(input.properties)) {
		throw new Error(`${input.kind} properties must be a JSON object, not an array`);
	}

	const validationSchema = fromAppSchemaObject(input.propertiesSchema);
	const result = validationSchema.safeParse(input.properties);

	if (!result.success) {
		throw new Error(`${input.kind} properties validation failed: ${result.error.message}`);
	}

	return result.data as Record<string, unknown>;
};

export const parseAppSchemaPropertiesSafe = (input: {
	properties: unknown;
	propertiesSchema: AppSchema;
}): ValidationResult => {
	if (!input.properties || typeof input.properties !== "object") {
		return {
			success: false,
			issues: [
				{
					path: "",
					message: "Properties must be a JSON object",
				},
			],
		};
	}

	if (Array.isArray(input.properties)) {
		return {
			success: false,
			issues: [
				{
					path: "",
					message: "Properties must be a JSON object, not an array",
				},
			],
		};
	}

	const validationSchema = fromAppSchemaObject(input.propertiesSchema);
	const result = validationSchema.safeParse(input.properties);

	if (!result.success) {
		const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		}));
		return { success: false, issues };
	}

	return { success: true, data: result.data as Record<string, unknown> };
};
