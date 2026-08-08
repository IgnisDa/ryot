import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	AppSchema,
	getOrderedAppSchemaFieldEntries,
	materializeAppSchemaChoices,
} from "./property-schema";

const decodeSchema = (value: unknown) => Schema.decodeUnknownSync(AppSchema)(value);

const enumField = (choices: unknown, defaultValue?: unknown) => ({
	choices,
	type: "enum",
	label: "Status",
	...(defaultValue === undefined ? {} : { defaultValue }),
	description: "Status value",
});

const enumArrayField = (choices: unknown, defaultValue?: unknown) => ({
	choices,
	label: "Statuses",
	type: "enum-array",
	...(defaultValue === undefined ? {} : { defaultValue }),
	description: "Status values",
});

const numberField = (extra: Record<string, unknown>) => ({
	...extra,
	type: "number",
	label: "Progress",
	description: "Progress value",
});

describe("AppSchema number normalization", () => {
	it("requires a round definition", () => {
		expect(() => decodeSchema({ fields: { progress: numberField({ normalize: {} }) } })).toThrow();
	});
});

describe("AppSchema presentation metadata", () => {
	it("accepts visibility rules", () => {
		expect(
			decodeSchema({
				fields: {
					secret: { type: "string", label: "Secret", description: "An advanced secret" },
					advanced: { type: "boolean", label: "Advanced", description: "Show advanced fields" },
				},
				rules: [
					{
						path: ["secret"],
						kind: "visibility",
						visibility: { hidden: true },
						when: { operator: "neq", path: ["advanced"], value: true },
					},
				],
			}),
		).toMatchObject({ rules: [{ kind: "visibility", visibility: { hidden: true } }] });
	});

	it("orders positioned fields stably and leaves position optional", () => {
		const schema = decodeSchema({
			fields: {
				last: { type: "string", label: "Last", description: "Last" },
				alsoLast: { type: "string", label: "Also last", description: "Also last" },
				first: { type: "string", label: "First", position: 1, description: "First" },
				second: { type: "string", label: "Second", position: 2, description: "Second" },
				secondTie: { position: 2, type: "string", label: "Second tie", description: "Second tie" },
			},
		});

		expect(getOrderedAppSchemaFieldEntries(schema.fields).map(([key]) => key)).toEqual([
			"first",
			"second",
			"secondTie",
			"last",
			"alsoLast",
		]);
		expect(schema.fields.last?.position).toBeUndefined();
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"rejects non-finite positions: %s",
		(position) => {
			expect(() =>
				decodeSchema({
					fields: { value: { type: "string", label: "Value", position, description: "Value" } },
				}),
			).toThrow();
		},
	);

	it.each([
		{ kind: "url" },
		{ kind: "email" },
		{ kind: "upload", allowedFileExtensions: ["csv", "json"] },
	])("accepts the $kind string format", (format) => {
		expect(
			decodeSchema({
				fields: {
					value: { type: "string", label: "Value", format, description: "A value" },
				},
			}),
		).toMatchObject({ fields: { value: { format } } });
	});

	it("rejects defaults for upload string formats", () => {
		expect(() =>
			decodeSchema({
				fields: {
					file: {
						label: "File",
						type: "string",
						description: "A file",
						defaultValue: "export.json",
						format: { kind: "upload", allowedFileExtensions: ["json"] },
					},
				},
			}),
		).toThrow();
	});

	it.each([
		{ allowedFileExtensions: [] },
		{ allowedFileExtensions: [""] },
		{ allowedFileExtensions: [" csv"] },
		{ allowedFileExtensions: ["CSV"] },
		{ allowedFileExtensions: [".csv"] },
		{ allowedFileExtensions: ["csv", "csv"] },
	])("rejects invalid upload extensions %#", ({ allowedFileExtensions }) => {
		expect(() =>
			decodeSchema({
				fields: {
					file: {
						label: "File",
						type: "string",
						description: "A file",
						format: { kind: "upload", allowedFileExtensions },
					},
				},
			}),
		).toThrow();
	});
});

describe("AppSchema enum choices", () => {
	it("accepts labeled static and dynamic choices", () => {
		expect(
			decodeSchema({
				fields: {
					region: enumField({ kind: "dynamic", source: "regions" }),
					status: enumField(
						{ kind: "static", values: [{ value: "active", label: "Active" }] },
						"active",
					),
				},
			}),
		).toMatchObject({ fields: { status: { defaultValue: "active" } } });
	});

	it.each([
		{
			name: "empty choice values",
			field: enumField({ kind: "static", values: [] }),
		},
		{
			name: "blank choice value",
			field: enumField({ kind: "static", values: [{ value: "  " }] }),
		},
		{
			name: "blank choice label",
			field: enumField({ kind: "static", values: [{ value: "active", label: " " }] }),
		},
		{
			name: "duplicate choice values",
			field: enumField({ kind: "static", values: [{ value: "active" }, { value: "active" }] }),
		},
		{
			name: "blank dynamic source",
			field: enumField({ kind: "dynamic", source: " " }),
		},
		{
			name: "static default outside choices",
			field: enumField({ kind: "static", values: [{ value: "active" }] }, "inactive"),
		},
		{
			name: "dynamic default",
			field: enumField({ kind: "dynamic", source: "statuses" }, "active"),
		},
		{
			name: "enum array default outside choices",
			field: enumArrayField({ kind: "static", values: [{ value: "active" }] }, ["inactive"]),
		},
		{
			name: "enum array dynamic default",
			field: enumArrayField({ kind: "dynamic", source: "statuses" }, ["active"]),
		},
	])("rejects $name", ({ field }) => {
		expect(() => decodeSchema({ fields: { status: field } })).toThrow();
	});

	it("does not accept the removed options property", () => {
		expect(() =>
			decodeSchema({
				fields: {
					status: {
						label: "Status",
						type: "enum",
						options: ["active"],
						description: "Status value",
					},
				},
			}),
		).toThrow();
	});

	it("materializes dynamic choices recursively and preserves static fields", () => {
		const staticField = {
			type: "enum",
			label: "Status",
			description: "Status value",
			choices: { kind: "static", values: [{ value: "active" }] },
		} satisfies AppSchema["fields"][string];
		const schema = {
			fields: {
				static: staticField,
				status: {
					type: "enum",
					label: "Status",
					description: "Status value",
					choices: { kind: "dynamic", source: "statuses" },
				},
				metadata: {
					type: "object",
					label: "Metadata",
					description: "Metadata",
					properties: {
						region: {
							type: "enum",
							label: "Status",
							description: "Status value",
							choices: { kind: "dynamic", source: "regions" },
						},
					},
				},
			},
		} satisfies AppSchema;

		const result = materializeAppSchemaChoices(schema, {
			regions: [{ value: "us", label: "United States" }],
			statuses: [{ value: "active" }, { value: "inactive" }],
		});

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success.fields.static).toBe(staticField);
			expect(result.success.fields.status).toMatchObject({
				choices: { kind: "static", values: [{ value: "active" }, { value: "inactive" }] },
			});
			expect(result.success.fields.metadata).toMatchObject({
				properties: {
					region: {
						choices: { kind: "static", values: [{ value: "us", label: "United States" }] },
					},
				},
			});
		}
	});

	it("reports missing and invalid dynamic choice sources", () => {
		const schema = decodeSchema({
			fields: { status: enumField({ kind: "dynamic", source: "statuses" }) },
		});

		const missing = materializeAppSchemaChoices(schema, {});
		expect(Result.isFailure(missing)).toBe(true);
		if (Result.isFailure(missing)) {
			expect(missing.failure).toEqual([
				{
					source: "statuses",
					path: ["fields", "status", "choices", "source"],
					message: "Choice source 'statuses' for field 'status' was not provided",
				},
			]);
		}

		const invalid = materializeAppSchemaChoices(schema, {
			statuses: [{ value: "active" }, { value: "active" }],
		});
		expect(Result.isFailure(invalid)).toBe(true);
		if (Result.isFailure(invalid)) {
			expect(invalid.failure).toEqual([
				{
					source: "statuses",
					path: ["fields", "status", "choices", "values"],
					message:
						"Choice source 'statuses' for field 'status' contains invalid or duplicate choice values",
				},
			]);
		}
	});
});
