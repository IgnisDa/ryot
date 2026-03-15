import { Effect, Schema } from "effect";

import { DbError } from "../errors";
import { AppSchema, type AppPropertyDefinition } from "./property-schema";

export const decodeStoredSchema = <S extends Schema.Constraint>(
	value: unknown,
	valueSchema: S,
	message: string,
) =>
	Schema.decodeUnknownEffect(valueSchema)(value).pipe(
		Effect.mapError(() => new DbError({ message })),
	);

export const decodeStoredAppSchema = (value: unknown, message: string) =>
	decodeStoredSchema(value, AppSchema, message);

export const stringField = (label: string, description: string) =>
	({ label, description, type: "string" }) as const;

export const translatableStringField = (label: string, description: string) =>
	({ label, description, type: "string", translatable: true }) as const;

export const integerField = (label: string, description: string) =>
	({ label, description, type: "integer" }) as const;

export const numberField = (label: string, description: string) =>
	({ label, description, type: "number" }) as const;

export const stringArrayField = (label: string, description: string) =>
	({
		label,
		description,
		type: "array",
		items: { type: "string", label: "Item", description: "Item" },
	}) as const;

const imageItemSchema: AppPropertyDefinition = {
	label: "Item",
	type: "object",
	description: "Item",
	unknownKeys: "strict",
	properties: {
		key: { type: "string", label: "Key", description: "Key" },
		url: { type: "string", label: "Url", description: "Url" },
		type: {
			type: "enum",
			label: "Type",
			description: "Type",
			options: ["s3", "remote"],
			validation: { required: true },
		},
	},
};

export const imagesField = (description: string) =>
	({
		description,
		type: "array",
		label: "Images",
		translatable: true,
		items: imageItemSchema,
	}) as const;
