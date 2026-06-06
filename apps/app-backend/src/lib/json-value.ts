import { z } from "@hono/zod-openapi";

export type JsonValue =
	| null
	| number
	| string
	| boolean
	| JsonValue[]
	| { [key: string]: JsonValue };

export const isJsonValue = (value: unknown): value is JsonValue => {
	if (value === null) {
		return true;
	}

	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return false;
		}

		return Object.values(value).every(isJsonValue);
	}

	return false;
};

export const jsonValueSchema = z.unknown().refine(isJsonValue, "Value must be JSON-safe");
