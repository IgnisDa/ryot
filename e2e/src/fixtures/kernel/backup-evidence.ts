import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { unzipSync } from "fflate";

import { requirePresent } from "~/support/assertions";

import { fakeProviderDetailsResult, providerSandboxSource } from "./sandbox-provider";
import { installTestPluginBundle, uninstallTestPlugin } from "./test-plugin";

export const readBackupEvidenceSection = (
	bytes: Uint8Array,
	path: "events.ndjson" | "entity-dependencies.ndjson",
) =>
	Effect.forEach(
		new TextDecoder()
			.decode(requirePresent(unzipSync(bytes)[path], `Missing backup section '${path}'`))
			.trimEnd()
			.split("\n")
			.filter((line) => line.length > 0),
		(line) =>
			Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)))(line),
	);

export const installBackupEvidencePlugin = Effect.fn(function* () {
	const suffix = crypto.randomUUID();
	const entitySchemaSlug = EntitySchemaSlug.make(`evidence-record-${suffix}`);
	const eventSchemaSlug = EventSchemaSlug.make(`evidence-captured-${suffix}`);
	const providerSlug = `evidence-provider-${suffix}`;
	const detailsSlug = `${providerSlug}.details`;
	const detailsEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
	const plugin = yield* Effect.acquireRelease(
		installTestPluginBundle({
			scope: "system",
			pluginSlug: `backup-evidence-${suffix}`,
			providers: [
				{
					slug: providerSlug,
					information: { source: "e2e" },
					name: "Evidence reference provider",
					rootEntitySchemaSlug: entitySchemaSlug,
				},
			],
			scripts: [
				{
					providerSlug,
					capabilities: [],
					kind: "provider",
					slug: detailsSlug,
					entry: detailsEntry,
					providerOperation: "details",
					requiredPluginConfigKeys: [],
					name: "Evidence reference details",
				},
			],
			files: {
				[detailsEntry]: providerSandboxSource({
					slug: detailsSlug,
					operation: "details",
					name: "Evidence reference details",
					result: fakeProviderDetailsResult({
						name: "Shared reference",
						properties: { quantity: 99 },
					}),
				}),
			},
			entitySchemas: [
				{
					icon: "book",
					slug: entitySchemaSlug,
					name: "Evidence record",
					propertiesSchema: {
						fields: {
							quantity: { type: "number", label: "Quantity", description: "Current quantity" },
						},
					},
					eventSchemas: [
						{
							slug: eventSchemaSlug,
							name: "Evidence captured",
							propertiesSchema: {
								fields: {
									evidence: {
										type: "object",
										label: "Evidence",
										description: "Retained quantities and references",
										properties: {
											count: { label: "Count", type: "integer", description: "Frozen count" },
											quantity: {
												type: "number",
												label: "Quantity",
												description: "Frozen quantity",
											},
											groups: {
												type: "array",
												label: "Groups",
												description: "Ordered evidence groups",
												items: {
													type: "object",
													label: "Group",
													description: "Frozen group evidence",
													properties: {
														quantity: {
															type: "number",
															label: "Quantity",
															description: "Frozen group quantity",
														},
														entityIds: {
															type: "array",
															label: "References",
															description: "Entities retained as evidence",
															items: {
																type: "string",
																label: "Reference",
																description: "Retained entity identity",
																reference: { required: true, kind: "entity-id" },
															},
														},
													},
												},
											},
										},
									},
								},
							},
						},
					],
				},
			],
		}),
		uninstallTestPlugin,
	);
	return {
		providerSlug,
		eventSchemaSlug,
		entitySchema: { slug: entitySchemaSlug, owner: definitionOwner(plugin.pluginId) },
	};
});
