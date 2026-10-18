import { describe, expect, it } from "@effect/vitest";
import { EntitySchemaSlug, PluginId } from "@ryot-app/contract/schema/brands";
import { imagesField } from "@ryot-app/contract/schema/core";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import {
	buildSubmission,
	entityFormValues,
	entityPropertiesPayload,
	managedAssetsOf,
} from "./model";

const schema = {
	fields: {
		title: { label: "Title", type: "string", description: "Title" },
		meta: {
			label: "Meta",
			type: "object",
			description: "Meta",
			properties: { keep: { label: "Keep", type: "boolean", description: "Keep" } },
		},
		images: {
			type: "array",
			label: "Images",
			description: "Images",
			items: {
				label: "Item",
				type: "object",
				properties: {},
				description: "Item",
				validation: { asset: true },
			},
		},
	},
} satisfies AppSchema;

describe("entity editor model", () => {
	it("finds nested managed assets by schema", () => {
		const nested: AppSchema = {
			fields: {
				parts: {
					type: "array",
					label: "Parts",
					description: "Parts",
					items: {
						label: "Part",
						type: "object",
						description: "Part",
						properties: { images: imagesField("Images") },
					},
				},
			},
		};
		const kept = { type: "local", key: "nested" } as const;
		const undeclared = { type: "local", key: "undeclared" } as const;
		expect(
			managedAssetsOf({ unrelated: [undeclared], parts: [{ images: [kept] }] }, nested),
		).toEqual([kept]);
	});
	it("keeps declared nested values across a save", () => {
		const stored = { extra: 1, title: "A", meta: { keep: true } };
		const values = entityFormValues(schema, stored);

		expect(values["title"]).toBe("A");
		expect(entityPropertiesPayload(schema, { ...values, title: "B" }, "edit", stored)).toEqual({
			title: "B",
			meta: { keep: true },
		});
	});

	it("builds a trimmed submission carrying relationship properties", () => {
		const submission = buildSubmission({
			name: "  Curl ",
			properties: { title: "x" },
			target: { kind: "create" },
			relationships: { "part-targets": [] },
			entitySchema: {
				slug: EntitySchemaSlug.make("part"),
				owner: { kind: "plugin", pluginId: PluginId.make("plugin-1") },
			},
		});

		expect(submission).toMatchObject({
			name: "Curl",
			target: { kind: "create" },
			relationships: [{ targets: [], relationshipSchemaSlug: "part-targets" }],
			entitySchema: { slug: "part", owner: { kind: "plugin", pluginId: "plugin-1" } },
		});
	});
});
