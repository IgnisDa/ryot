import { Result, Schema } from "effect";

import { JsonValue } from "../../schema/json";
import type { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import {
	DeclarationReference,
	EntitySchemaReference,
	KernelDefinitionOwner,
	RelationshipSchemaReference,
} from "../plugins/references";

export const dataJsonSource = "data-json";
export const dataJsonSourceReference: DeclarationReference = {
	slug: dataJsonSource,
	owner: { kind: "kernel" },
};

export const DataRecordProperties = Schema.Record(Schema.String, JsonValue);

export const DataRecordTimestamp = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			Result.isSuccess(Schema.decodeResult(Schema.DateTimeUtcFromString)(value)),
		),
	),
);

export const entityDataFields = {
	name: Schema.String,
	properties: DataRecordProperties,
	entitySchema: EntitySchemaReference,
};

export const relationshipDataFields = {
	properties: DataRecordProperties,
	relationshipSchema: RelationshipSchemaReference,
};

export const eventDataFields = {
	eventSchemaSlug: Schema.String,
	occurredAt: DataRecordTimestamp,
	properties: DataRecordProperties,
};

const entityReferenceFields = { key: Schema.NonEmptyString, entitySchema: EntitySchemaReference };

export const DataJsonEntity = Schema.Union([
	strictStruct({ ...entityDataFields, ...entityReferenceFields, kind: Schema.Literal("custom") }),
	strictStruct({
		...entityReferenceFields,
		entityId: Schema.NonEmptyString,
		kind: Schema.Literal("existing"),
	}),
	strictStruct({
		...entityReferenceFields,
		value: Schema.NonEmptyString,
		provider: DeclarationReference,
		kind: Schema.Literal("provider"),
		identifierType: Schema.NonEmptyString,
	}),
]);

export const DataJsonRelationship = strictStruct({
	...relationshipDataFields,
	key: Schema.NonEmptyString,
	sourceEntityKey: Schema.NonEmptyString,
	targetEntityKey: Schema.NonEmptyString,
});

export const DataJsonEvent = strictStruct({
	...eventDataFields,
	key: Schema.NonEmptyString,
	entityKey: Schema.NonEmptyString,
	sessionEntityKey: Schema.optional(Schema.NonEmptyString),
});

export const DataJsonDocument = strictStruct({
	events: Schema.Array(DataJsonEvent),
	entities: Schema.Array(DataJsonEntity),
	relationships: Schema.Array(DataJsonRelationship),
});

export type DataJsonEvent = typeof DataJsonEvent.Type;
export type DataJsonEntity = typeof DataJsonEntity.Type;
export type DataJsonDocument = typeof DataJsonDocument.Type;
export type DataJsonRelationship = typeof DataJsonRelationship.Type;

export const DataJsonImportBody = strictStruct({
	uploadToken: Schema.NonEmptyString,
	submissionKey: Schema.optional(Schema.NonEmptyString),
	source: strictStruct({ owner: KernelDefinitionOwner, slug: Schema.Literal(dataJsonSource) }),
});

export const dataJsonImportInputSchema: AppSchema = {
	unknownKeys: "strict",
	fields: {
		submissionKey: {
			type: "string",
			label: "Submission key",
			description: "Optional key to reuse the same run when retrying this submission.",
		},
		uploadToken: {
			type: "string",
			label: "JSON file",
			validation: { required: true },
			description: "A Ryot data document using existing schemas.",
			format: { kind: "upload", allowedFileExtensions: ["json"] },
		},
	},
};

export const dataJsonIntegrationSettingsSchema: AppSchema = { fields: {}, unknownKeys: "strict" };
