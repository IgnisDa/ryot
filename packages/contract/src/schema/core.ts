import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Effect, Schema } from "effect";

import { DbError } from "../errors";
import { type AppPropertyDefinition, AppSchema } from "./property-schema";

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

export const stringField = <Text>(label: Text, description: string) =>
	({ label, description, type: "string" }) as const;

export const translatableStringField = <Text>(label: Text, description: string) =>
	({ label, description, type: "string", translatable: true }) as const;

export const integerField = <Text>(label: Text, description: string) =>
	({ label, description, type: "integer" }) as const;

export const numberField = <Text>(label: Text, description: string) =>
	({ label, description, type: "number" }) as const;

const itemLabel = kernelMessage("definition.property.item");

export const stringArrayField = <Text>(label: Text, description: string) =>
	({
		label,
		description,
		type: "array",
		items: { type: "string", label: itemLabel, description: "Item" },
	}) as const;

export const managedAssetItemSchema = {
	type: "object",
	label: itemLabel,
	description: "Item",
	unknownKeys: "strict",
	validation: { asset: true },
	properties: {
		key: {
			type: "string",
			description: "Key",
			label: kernelMessage("definition.property.asset-key"),
		},
		url: {
			type: "string",
			description: "Url",
			label: kernelMessage("definition.property.asset-url"),
		},
		type: {
			type: "enum",
			description: "Type",
			validation: { required: true },
			label: kernelMessage("definition.property.asset-type"),
			choices: {
				kind: "static",
				values: [{ value: "local" }, { value: "s3" }, { value: "remote" }],
			},
		},
	},
} satisfies AppPropertyDefinition;

const assetArrayField = (label: Message, description: string) =>
	({ label, description, type: "array", items: managedAssetItemSchema }) as const;

export const imagesField = (description: string) =>
	({
		...assetArrayField(kernelMessage("definition.property.images"), description),
		translatable: true,
	}) as const;

export const videosField = (description: string) =>
	assetArrayField(kernelMessage("definition.property.videos"), description);
