import type { AppSchema } from "@ryot/ts-utils";
import { fromAppSchemaObject } from "@ryot/ts-utils";

export const parseAppSchemaProperties = (input: {
	kind: string;
	properties: unknown;
	propertiesSchema: AppSchema;
}) => {
	if (!input.properties || typeof input.properties !== "object") {
		throw new Error(`${input.kind} properties must be a JSON object`);
	}

	if (Array.isArray(input.properties)) {
		throw new Error(
			`${input.kind} properties must be a JSON object, not an array`,
		);
	}

	const validationSchema = fromAppSchemaObject(input.propertiesSchema);
	const result = validationSchema.safeParse(input.properties);

	if (!result.success) {
		throw new Error(
			`${input.kind} properties validation failed: ${result.error.message}`,
		);
	}

	return result.data as Record<string, unknown>;
};
