import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AppSchema } from "../../schema/property-schema";
import {
	collectionFieldsToAppSchema,
	decodeCollectionFields,
	type KeyedCollectionField,
} from "./fields";
import { CreateCollectionBody, UpdateCollectionBody } from "./schemas";

const everyFieldType: ReadonlyArray<KeyedCollectionField> = [
	{
		key: "note",
		type: "text",
		label: "Note",
		required: true,
		description: "Note",
		defaultValue: "none",
	},
	{ key: "score", label: "Score", type: "number", required: false, defaultValue: 4.5 },
	{ key: "owned", label: "Owned", type: "boolean", required: false, defaultValue: false },
	{
		type: "date",
		key: "Owned On",
		required: false,
		label: "Owned On",
		description: "When",
		defaultValue: "2026-01-01",
	},
	{
		key: "seen-at",
		required: false,
		label: "Seen At",
		type: "datetime",
		defaultValue: "2026-01-01T00:00:00Z",
	},
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
	it("reloads all eight declarations in order without losing equal descriptions or keys", () => {
		const fields = everyFieldType.toReversed();
		expect(decodeCollectionFields(JSON.parse(JSON.stringify(fields)))).toEqual(
			Result.succeed(fields),
		);
		const schema = collectionFieldsToAppSchema(fields);
		expect(Result.isSuccess(Schema.decodeResult(AppSchema)(schema))).toBe(true);
		expect(schema.unknownKeys).toBe("strict");
		expect(Object.values(schema.fields).map(({ position }) => position)).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7,
		]);
	});

	it("defaults absent descriptions only in the compiled schema", () => {
		const fields = [{ key: "note", type: "text", label: "Note", required: false }] as const;
		expect(decodeCollectionFields(fields)).toEqual(Result.succeed(fields));
		expect(collectionFieldsToAppSchema(fields).fields["note"]?.description).toBe("Note");
	});

	it.each([
		["missing keys", [{ label: "A", type: "text", required: false }]],
		["unknown properties", [{ ...everyFieldType[0], position: 0 }]],
		["compiled schemas", collectionFieldsToAppSchema(everyFieldType)],
		["null", null],
		["duplicate keys", [everyFieldType[0], everyFieldType[0]]],
		["reserved keys", [{ ...everyFieldType[0], key: "rank" }]],
		["unsafe keys", [{ ...everyFieldType[0], key: "__proto__" }]],
		["blank keys", [{ ...everyFieldType[0], key: " " }]],
		["blank labels", [{ ...everyFieldType[0], label: "" }]],
		["unnormalized labels", [{ ...everyFieldType[0], label: " A " }]],
		["blank descriptions", [{ ...everyFieldType[0], description: "" }]],
		["invalid defaults", [{ ...everyFieldType[0], defaultValue: false }]],
		[
			"invalid dates",
			[{ key: "date", type: "date", label: "Date", required: false, defaultValue: "bad" }],
		],
		["missing choices", [{ key: "a", label: "A", type: "choice", required: false }]],
		[
			"duplicate choices",
			[{ key: "a", label: "A", type: "choice", required: false, choices: ["x", "x"] }],
		],
		[
			"unlisted defaults",
			[
				{
					key: "a",
					label: "A",
					type: "choice",
					choices: ["x"],
					required: false,
					defaultValue: "y",
				},
			],
		],
		["wrong choices", [{ ...everyFieldType[0], choices: ["x"] }]],
		[
			"too many fields",
			Array.from({ length: 51 }, (_, index) => ({ ...everyFieldType[0], key: String(index) })),
		],
	])("rejects stored declarations with %s", (_name, input) => {
		expect(Result.isFailure(decodeCollectionFields(input))).toBe(true);
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
