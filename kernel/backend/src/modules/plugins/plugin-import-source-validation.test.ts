import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { fixtureManifest } from "./test-support";
import { validateImportSourceInputSchemas } from "./validation";

const importSource = {
	slug: "fixture",
	name: "Fixture",
	requiredPluginConfigKeys: [],
	description: "Fixture import",
	workflowSlug: "fixture-workflow",
	inputSchema: {
		unknownKeys: "strict" as const,
		fields: {
			uploadToken: {
				label: "Export",
				description: "Export",
				type: "string" as const,
				validation: { required: true as const },
				format: { kind: "upload" as const, allowedFileExtensions: ["zip"] },
			},
		},
	},
};

it.effect("accepts top-level upload properties in import input schemas", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		yield* validateImportSourceInputSchemas({ ...manifest, importSources: [importSource] });
		expect(true).toBe(true);
	}),
);

it.effect("formats import input schema definition issues", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const error = yield* Effect.flip(
			validateImportSourceInputSchemas({
				...manifest,
				importSources: [
					{
						...importSource,
						inputSchema: {
							...importSource.inputSchema,
							rules: [
								{
									path: ["missing"],
									kind: "validation" as const,
									validation: { required: true as const },
									when: { path: ["uploadToken"], operator: "exists" as const },
								},
							],
						},
					},
				],
			}),
		);
		expect(error.issues.join("; ")).toContain(
			"Import source fixture in plugin fixture has an invalid inputSchema",
		);
	}),
);

it.effect("rejects import fields reserved by the runtime", () =>
	Effect.gen(function* () {
		for (const field of [
			"source",
			"integrationId",
			"integrationContext",
			"integrationScriptSlug",
		]) {
			const manifest = fixtureManifest();
			const error = yield* Effect.flip(
				validateImportSourceInputSchemas({
					...manifest,
					importSources: [
						{
							...importSource,
							inputSchema: {
								unknownKeys: "strict",
								fields: { [field]: { type: "string", label: "Reserved", description: "Reserved" } },
							},
						},
					],
				}),
			);
			expect(error.issues).toContain(
				`Import source fixture in plugin fixture declares reserved input field: ${field}`,
			);
		}
	}),
);

it.effect("rejects upload-token fields without upload format", () =>
	Effect.gen(function* () {
		for (const field of ["uploadToken", "historyUploadToken"]) {
			const manifest = fixtureManifest();
			const error = yield* Effect.flip(
				validateImportSourceInputSchemas({
					...manifest,
					importSources: [
						{
							...importSource,
							inputSchema: {
								unknownKeys: "strict",
								fields: { [field]: { type: "string", label: "Token", description: "Token" } },
							},
						},
					],
				}),
			);
			expect(error.issues).toContain(
				`Import source fixture in plugin fixture declares upload token field without upload format: ${field}`,
			);
		}
	}),
);
