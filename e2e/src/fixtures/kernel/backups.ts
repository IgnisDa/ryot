import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { BackupRunId, EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { backupRunRecipe } from "@ryot-app/ryotql-recipes/backups";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Option, Schema } from "effect";
import { unzipSync } from "fflate";

import { requirePresent } from "~/support/assertions";
import { webRequest } from "~/support/web-request";

import type { Client } from "./auth";
import { pollUntil } from "./polling";
import { executeRyotQLRecipe } from "./ryotql";
import { fakeProviderDetailsResult, providerSandboxSource } from "./sandbox-provider";
import { uploadTemporaryArchive } from "./temporary-archive";
import { installTestPluginBundle, uninstallTestPlugin } from "./test-plugin";

export const pollBackupRunUntilTerminal = (client: Client, runId: string) =>
	pollUntil(
		`Backup run '${runId}' to complete`,
		Effect.gen(function* () {
			const run = Option.getOrUndefined(
				yield* executeRyotQLRecipe(client, backupRunRecipe({ id: runId })),
			);
			if (run === undefined) {
				throw new Error(`Backup run '${runId}' not found`);
			}
			return run.status === "completed" || run.status === "failed" ? run : null;
		}),
	);

export const startBackupExport = (client: Client) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.backups.createExport());
		return requirePresent(result.id, "Backup export run id is missing");
	});

export const downloadBackupArchive = (client: Client, runId: string) =>
	Effect.gen(function* () {
		const ticket = yield* client.call((c) =>
			c.backups.createDownloadTicket({ params: { id: BackupRunId.make(runId) } }),
		);
		const response = yield* webRequest(`${client.target.apiUrl}${ticket.url}`);
		if (response.status !== 200) {
			throw new Error(`Could not download backup archive (${response.status})`);
		}

		const contentType = response.headers
			.get("content-type")
			?.split(";", 1)[0]
			?.trim()
			.toLowerCase();
		if (contentType !== "application/zip") {
			throw new Error(`Backup archive has invalid content type '${contentType ?? "missing"}'`);
		}

		const contentDisposition = response.headers.get("content-disposition");
		if (!contentDisposition || !/^attachment(?:;|$)/i.test(contentDisposition.trim())) {
			throw new Error("Backup archive is missing an attachment content disposition");
		}

		const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
		return { bytes, headers: response.headers };
	});

export const exportAndDownloadBackup = (client: Client) =>
	Effect.gen(function* () {
		const id = yield* startBackupExport(client);
		const run = yield* pollBackupRunUntilTerminal(client, id);
		if (run.status !== "completed") {
			throw new Error(`Backup export '${id}' failed with ${run.failure?.code ?? "unknown"}`);
		}

		const { bytes } = yield* downloadBackupArchive(client, id);
		return { id, run, bytes };
	});

export const restoreBackup = (client: Client, bytes: Uint8Array) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadTemporaryArchive(client, bytes, { fileName: "backup.zip" });
		const result = yield* client.call((c) => c.backups.createRestore({ payload: { uploadToken } }));
		const id = requirePresent(result.id, "Backup restore run id is missing");
		const run = yield* pollBackupRunUntilTerminal(client, id);
		return { id, run };
	});

export const readBackupSection = (
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

export const installBackupReferencePlugin = Effect.fn(function* () {
	const suffix = yield* randomUuid;
	const entitySchemaSlug = EntitySchemaSlug.make(`backup-record-${suffix}`);
	const eventSchemaSlug = EventSchemaSlug.make(`backup-captured-${suffix}`);
	const providerSlug = `backup-provider-${suffix}`;
	const detailsSlug = `${providerSlug}.details`;
	const detailsEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
	const plugin = yield* Effect.acquireRelease(
		installTestPluginBundle({
			scope: "system",
			pluginSlug: `backup-references-${suffix}`,
			providers: [
				{
					slug: providerSlug,
					information: { source: "e2e" },
					name: "Backup reference provider",
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
					name: "Backup reference details",
				},
			],
			files: {
				[detailsEntry]: providerSandboxSource({
					slug: detailsSlug,
					operation: "details",
					name: "Backup reference details",
					result: fakeProviderDetailsResult({
						name: "Shared reference",
						properties: { quantity: 99 },
					}),
				}),
			},
			entitySchemas: [
				{
					icon: "book",
					name: "Backup record",
					slug: entitySchemaSlug,
					propertiesSchema: {
						fields: {
							quantity: { type: "number", label: "Quantity", description: "Current quantity" },
						},
					},
					eventSchemas: [
						{
							slug: eventSchemaSlug,
							name: "Snapshot captured",
							propertiesSchema: {
								fields: {
									snapshot: {
										type: "object",
										label: "Snapshot",
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
												description: "Ordered snapshot groups",
												items: {
													type: "object",
													label: "Group",
													description: "Frozen group snapshot",
													properties: {
														quantity: {
															type: "number",
															label: "Quantity",
															description: "Frozen group quantity",
														},
														entityIds: {
															type: "array",
															label: "References",
															description: "Entities retained in the snapshot",
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
