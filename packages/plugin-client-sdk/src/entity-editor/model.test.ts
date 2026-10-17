import { describe, expect, it } from "@effect/vitest";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { imagesField } from "@ryot-app/contract/schema/core";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import {
	buildSubmission,
	entityFormValues,
	entityPropertiesPayload,
	unreferencedUploads,
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
	it("finds nested uploads by schema and retains assets referenced by relationships", () => {
		const nested: AppSchema = {
			fields: {
				exercises: {
					type: "array",
					label: "Exercises",
					description: "Exercises",
					items: {
						type: "object",
						label: "Exercise",
						description: "Exercise",
						properties: { images: imagesField("Images") },
					},
				},
			},
		};
		const kept = { type: "local", key: "nested" } as const;
		const relationship = { type: "local", key: "relationship" } as const;
		const dropped = { type: "local", key: "dropped" } as const;
		const uploaded = new Map<string, ManagedAssetLocator>([
			["local:nested", kept],
			["local:relationship", relationship],
			["local:dropped", dropped],
		]);
		expect(
			unreferencedUploads(
				uploaded,
				{ unrelated: [dropped], exercises: [{ images: [kept] }] },
				nested,
				[relationship],
			),
		).toEqual([dropped]);
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

	it("lists only uploads that the saved properties no longer reference", () => {
		const kept = { key: "kept", type: "local" } as const;
		const dropped = { type: "local", key: "dropped" } as const;
		const uploaded = new Map<string, ManagedAssetLocator>([
			["local:kept", kept],
			["local:dropped", dropped],
		]);

		expect(unreferencedUploads(uploaded, { images: [kept] }, schema)).toEqual([dropped]);
	});

	it("builds a trimmed submission carrying relationship properties", () => {
		const submission = buildSubmission({
			name: "  Curl ",
			properties: { title: "x" },
			target: { kind: "create" },
			entitySchemaSlug: "exercise",
			relationships: { "exercise-targets": [] },
		});

		expect(submission).toMatchObject({
			name: "Curl",
			target: { kind: "create" },
			relationships: [{ targets: [], relationshipSchemaSlug: "exercise-targets" }],
		});
	});
});
