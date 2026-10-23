import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AppSchema } from "../../schema/property-schema";
import {
	appSchemaToCollectionFields,
	collectionFieldsToAppSchema,
	type KeyedCollectionField,
} from "./fields";
import { CreateCollectionBody, UpdateCollectionBody } from "./schemas";

const everyFieldType: ReadonlyArray<KeyedCollectionField> = [
	{ key: "note", type: "text", label: "Note", required: true, defaultValue: "none" },
	{ key: "score", label: "Score", type: "number", required: false, defaultValue: 4.5 },
	{ key: "owned", label: "Owned", type: "boolean", required: false, defaultValue: false },
	{ type: "date", key: "owned-on", required: false, label: "Owned On", description: "When" },
	{ key: "seen-at", required: false, label: "Seen At", type: "datetime" },
	{
		key: "format",
		type: "choice",
		required: true,
		label: "Format",
		defaultValue: "CD",
		choices: ["CD", "Vinyl"],
	},
	{
		key: "moods",
		label: "Moods",
		required: false,
		type: "multi-choice",
		defaultValue: ["Calm"],
		choices: ["Calm", "Loud"],
	},
	{ key: "tags", label: "Tags", required: false, type: "text-list", defaultValue: ["a"] },
];

describe("collection field model", () => {
	it("round-trips every field type through a strict app schema in field order", () => {
		const schema = collectionFieldsToAppSchema(everyFieldType.toReversed());
		expect(Result.isSuccess(Schema.decodeResult(AppSchema)(schema))).toBe(true);
		expect(schema.unknownKeys).toBe("strict");
		expect(appSchemaToCollectionFields(JSON.parse(JSON.stringify(schema)))).toEqual(
			Result.succeed(everyFieldType.toReversed()),
		);
	});

	it("defaults blank descriptions to the label", () => {
		const schema = collectionFieldsToAppSchema([
			{ key: "note", type: "text", label: "Note", required: false, description: "  " },
		]);
		expect(schema.fields["note"]?.description).toBe("Note");
	});

	it("decodes a v1-shaped schema keyed by display names", () => {
		expect(
			appSchemaToCollectionFields({
				unknownKeys: "strict",
				fields: {
					"Owned On": { type: "date", label: "Owned On", description: "Owned On" },
					Tags: {
						type: "array",
						label: "Tags",
						description: "Tags",
						items: { label: "Item", type: "string", description: "Item" },
					},
					Rating: {
						type: "number",
						label: "Rating",
						defaultValue: 3,
						description: "Out of five",
						validation: { required: true },
					},
					Format: {
						type: "enum",
						label: "Format",
						description: "Format",
						choices: { kind: "static", values: [{ value: "CD" }, { value: "Vinyl" }] },
					},
				},
			}),
		).toEqual(
			Result.succeed([
				{ type: "date", key: "Owned On", required: false, label: "Owned On" },
				{ key: "Tags", label: "Tags", required: false, type: "text-list" },
				{
					key: "Rating",
					type: "number",
					required: true,
					label: "Rating",
					defaultValue: 3,
					description: "Out of five",
				},
				{
					key: "Format",
					type: "choice",
					label: "Format",
					required: false,
					choices: ["CD", "Vinyl"],
				},
			]),
		);
	});

	it.each([
		[
			"patterns",
			{ label: "A", type: "string", description: "A", validation: { pattern: "^(a+)+$" } },
		],
		[
			"dynamic choices",
			{ label: "A", type: "enum", description: "A", choices: { source: "x", kind: "dynamic" } },
		],
		["formats", { label: "A", type: "string", description: "A", format: { kind: "url" } }],
		[
			"references",
			{ label: "A", type: "string", description: "A", reference: { kind: "entity-id" } },
		],
		["secrets", { label: "A", secret: true, type: "string", description: "A" }],
		["objects", { label: "A", type: "object", properties: {}, description: "A" }],
		["integers", { label: "A", type: "integer", description: "A" }],
		[
			"choice labels",
			{
				label: "A",
				type: "enum",
				description: "A",
				choices: { kind: "static", values: [{ value: "x", label: "X" }] },
			},
		],
		[
			"invalid choice defaults",
			{
				label: "A",
				type: "enum",
				description: "A",
				defaultValue: "y",
				choices: { kind: "static", values: [{ value: "x" }] },
			},
		],
	])("rejects stored schemas with %s", (_name, property) => {
		expect(
			Result.isFailure(
				appSchemaToCollectionFields({ unknownKeys: "strict", fields: { field: property } }),
			),
		).toBe(true);
	});

	it("rejects stored schemas with rules, non-strict keys, or reserved keys", () => {
		const note = { label: "Note", type: "string", description: "Note" };
		for (const schema of [
			{ fields: { note } },
			{ fields: { note }, unknownKeys: "passthrough" },
			{ unknownKeys: "strict", fields: { rank: note } },
			{
				fields: { note },
				unknownKeys: "strict",
				rules: [
					{
						path: ["note"],
						kind: "validation",
						validation: { required: true },
						when: { path: ["note"], operator: "exists" },
					},
				],
			},
		]) {
			expect(Result.isFailure(appSchemaToCollectionFields(schema))).toBe(true);
		}
	});
});

describe("collection wire bodies", () => {
	it("bounds collection names after trimming and descriptions", () => {
		const decode = Schema.decodeUnknownResult(CreateCollectionBody);
		expect(Result.isSuccess(decode({ name: ` ${"n".repeat(200)} ` }))).toBe(true);
		expect(Result.isFailure(decode({ name: "n".repeat(201) }))).toBe(true);
		expect(Result.isFailure(decode({ name: "n", description: "d".repeat(2001) }))).toBe(true);
	});

	it("rejects unknown field properties on member fields", () => {
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(UpdateCollectionBody)({
					name: "n",
					description: null,
					collectionId: "collection",
					fields: [{ label: "A", type: "text", required: false, validation: { pattern: "x" } }],
				}),
			),
		).toBe(true);
	});
});
