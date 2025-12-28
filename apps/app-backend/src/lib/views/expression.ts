import { z } from "zod";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";

export type JsonValue =
	| null
	| number
	| string
	| boolean
	| JsonValue[]
	| { [key: string]: JsonValue };

export const runtimeReferenceSchema = z.discriminatedUnion("type", [
	z
		.object({
			slug: nonEmptyTrimmedStringSchema,
			column: nonEmptyTrimmedStringSchema,
			type: z.literal("entity-column"),
		})
		.strict(),
	z
		.object({
			slug: nonEmptyTrimmedStringSchema,
			property: nonEmptyTrimmedStringSchema,
			type: z.literal("schema-property"),
		})
		.strict(),
	z
		.object({
			column: nonEmptyTrimmedStringSchema,
			joinKey: nonEmptyTrimmedStringSchema,
			type: z.literal("event-join-column"),
		})
		.strict(),
	z
		.object({
			joinKey: nonEmptyTrimmedStringSchema,
			property: nonEmptyTrimmedStringSchema,
			type: z.literal("event-join-property"),
		})
		.strict(),
]);

export type RuntimeRef = z.infer<typeof runtimeReferenceSchema>;

const isJsonValue = (value: unknown): value is JsonValue => {
	if (value === null) {
		return true;
	}

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
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

const jsonLiteralValueSchema = z
	.unknown()
	.nullable()
	.refine(isJsonValue, "Literal values must be JSON-safe");

export const viewExpressionSchema: z.ZodType<ViewExpression> = z.lazy(() => {
	return z.discriminatedUnion("type", [
		z
			.object({
				value: jsonLiteralValueSchema,
				type: z.literal("literal"),
			})
			.strict(),
		z
			.object({
				reference: runtimeReferenceSchema,
				type: z.literal("reference"),
			})
			.strict(),
		z
			.object({
				type: z.literal("coalesce"),
				values: z.array(viewExpressionSchema).min(1),
			})
			.strict(),
	]);
});

export type ViewExpression =
	| { type: "literal"; value: unknown | null }
	| { type: "reference"; reference: RuntimeRef }
	| { type: "coalesce"; values: ViewExpression[] };

export const nullViewExpression = {
	type: "literal",
	value: null,
} satisfies ViewExpression;

export const stringifyRuntimeReference = (reference: RuntimeRef) => {
	return reference.type === "entity-column"
		? `entity.${reference.slug}.@${reference.column}`
		: reference.type === "schema-property"
			? `entity.${reference.slug}.${reference.property}`
			: reference.type === "event-join-column"
				? `event.${reference.joinKey}.@${reference.column}`
				: `event.${reference.joinKey}.${reference.property}`;
};
