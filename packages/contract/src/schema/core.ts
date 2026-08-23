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
		items: { label: "Item", type: "string", description: "Item" },
	}) as const;

export const managedAssetItemSchema = {
	label: "Item",
	type: "object",
	description: "Item",
	unknownKeys: "strict",
	validation: { asset: true },
	properties: {
		key: { label: "Key", type: "string", description: "Key" },
		url: { label: "Url", type: "string", description: "Url" },
		type: {
			type: "enum",
			label: "Type",
			description: "Type",
			validation: { required: true },
			choices: {
				kind: "static",
				values: [{ value: "local" }, { value: "s3" }, { value: "remote" }],
			},
		},
	},
} satisfies AppPropertyDefinition;

const assetArrayField = (label: string, description: string) =>
	({ label, description, type: "array", items: managedAssetItemSchema }) as const;

export const imagesField = (description: string) =>
	({ ...assetArrayField("Images", description), translatable: true }) as const;

export const videosField = (description: string) => assetArrayField("Videos", description);
