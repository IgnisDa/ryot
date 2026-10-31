import { describe, expect, it } from "@effect/vitest";
import { managedAssetItemSchema } from "@ryot-app/contract/schema/core";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import { initialSchemaFormValues, schemaFormIssues, toSchemaFormPayload } from "./state";

const schema: AppSchema = {
	fields: {
		options: {
			type: "object",
			label: "Options",
			description: "Options",
			unknownKeys: "passthrough",
			properties: {
				name: { label: "Name", type: "string", description: "Name", defaultValue: "Default" },
				count: {
					type: "number",
					label: "Count",
					description: "Count",
					normalize: { round: { scale: 1 } },
				},
			},
		},
		groups: {
			type: "array",
			label: "Groups",
			description: "Groups",
			items: {
				type: "object",
				label: "Group",
				description: "Group",
				properties: {
					order: { label: "Order", type: "integer", defaultValue: 0, description: "Order" },
					name: {
						label: "Name",
						type: "string",
						description: "Name",
						validation: { required: true },
					},
					dates: {
						type: "array",
						label: "Dates",
						description: "Dates",
						items: { type: "date", label: "Date", description: "Date" },
					},
				},
			},
		},
	},
};

describe("recursive schema form state", () => {
	it("loads nested stored values without manufacturing absent parents", () => {
		expect(initialSchemaFormValues(schema, "UTC")).toEqual({
			groups: undefined,
			options: undefined,
		});
		const stored = { options: null, groups: [{ name: "A", dates: ["2026-01-01"] }] };
		expect(initialSchemaFormValues(schema, "UTC", stored)).toEqual(stored);
	});

	it("normalizes nested values, applies item defaults, and preserves passthrough keys", () => {
		expect(
			toSchemaFormPayload(schema, {
				options: { count: 1.26, extra: [true] },
				groups: [{ name: "A", dates: ["2026-01-01"] }],
			}),
		).toEqual({
			options: { count: 1.3, extra: [true], name: "Default" },
			groups: [{ order: 0, name: "A", dates: ["2026-01-01"] }],
		});
	});

	it("keeps explicit clears distinct from defaults and empty containers", () => {
		expect(toSchemaFormPayload(schema, { groups: [], options: null })).toEqual({
			groups: [],
			options: null,
		});
		expect(
			toSchemaFormPayload(schema, { options: { name: "" }, groups: [{ name: "", dates: [] }] }),
		).toEqual({ options: { name: "" }, groups: [{ name: "", order: 0, dates: [] }] });
	});

	it("routes required errors to the concrete array item", () => {
		expect(schemaFormIssues(schema, { groups: [{ name: "A" }, {}] })).toEqual([
			{ message: "Name is required", path: ["groups", "1", "name"] },
		]);
	});

	it("applies nested visibility and required rules without dropping unrelated siblings", () => {
		const conditional: AppSchema = {
			...schema,
			fields: {
				...schema.fields,
				enabled: { type: "boolean", label: "Enabled", defaultValue: false, description: "Enabled" },
			},
			rules: [
				{
					kind: "visibility",
					path: ["options", "name"],
					visibility: { hidden: true },
					when: { value: false, operator: "eq", path: ["enabled"] },
				},
			],
		};
		expect(toSchemaFormPayload(conditional, { options: { count: 2, name: "Hidden" } })).toEqual({
			enabled: false,
			options: { count: 2 },
		});
		expect(
			toSchemaFormPayload(conditional, { enabled: true, options: { name: "Visible" } }),
		).toEqual({ enabled: true, options: { name: "Visible" } });
	});

	it("validates asset metadata rather than only the locator", () => {
		const assets: AppSchema = {
			fields: {
				image: {
					...managedAssetItemSchema,
					properties: {
						...managedAssetItemSchema.properties,
						purpose: {
							type: "string",
							label: "Purpose",
							description: "Purpose",
							validation: { required: true },
						},
					},
				},
			},
		};
		expect(schemaFormIssues(assets, { image: { key: "a", type: "local" } })).toEqual([
			{ path: ["image", "purpose"], message: "Purpose is required" },
		]);
		expect(
			toSchemaFormPayload(assets, { image: { key: "a", type: "local", purpose: "cover" } }),
		).toEqual({ image: { key: "a", type: "local", purpose: "cover" } });
	});

	it("retains untouched redacted secret arrays but validates replacement rows", () => {
		const secrets: AppSchema = {
			fields: {
				accounts: {
					type: "array",
					label: "Accounts",
					description: "Accounts",
					validation: { required: true },
					items: {
						type: "object",
						label: "Account",
						description: "Account",
						properties: {
							name: { label: "Name", type: "string", description: "Name" },
							token: {
								secret: true,
								type: "string",
								label: "Token",
								description: "Token",
								validation: { required: true },
							},
						},
					},
				},
			},
		};
		const original = { accounts: [{ name: "First" }, { name: "Second" }] };
		expect(schemaFormIssues(secrets, original, "edit", original)).toEqual([]);
		expect(toSchemaFormPayload(secrets, original, "edit", original)).toEqual({});
		expect(schemaFormIssues(secrets, { accounts: [{ name: "Second" }] }, "edit", original)).toEqual(
			[{ message: "Token is required", path: ["accounts", "0", "token"] }],
		);
		expect(
			toSchemaFormPayload(
				secrets,
				{ accounts: [{ name: "Second", token: "replacement" }] },
				"edit",
				original,
			),
		).toEqual({ accounts: [{ name: "Second", token: "replacement" }] });
	});
});
