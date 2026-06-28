import { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { BackupRunId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { managedAssetItemSchema } from "@ryot-app/contract/schema/core";
import { Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createPluginScope,
	deleteUserAndWait,
	downloadBackupArchive,
	exportAndDownloadBackup,
	getEntity,
	installTestPluginBundle,
	literalSandboxSource,
	pollBackupRunUntilTerminal,
	restoreBackup,
	startBackupExport,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";

describe("backup lifecycle", () => {
	it.live("exports, isolates, downloads, and deletes a completed backup", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const runId = yield* startBackupExport(owner.client);
			const completed = yield* pollBackupRunUntilTerminal(owner.client, runId);
			if (completed.status !== "completed") {
				throw new Error(
					`Backup export '${runId}' failed with ${completed.failure?.code ?? "unknown"}`,
				);
			}

			const fetched = yield* owner.client.call((c) =>
				c.backups.getRun({ params: { id: BackupRunId.make(runId) } }),
			);
			const listed = yield* owner.client.call((c) => c.backups.listRuns({}));

			expect(fetched).toEqual(completed);
			expect(listed.items.find(({ id }) => id === runId)).toEqual(completed);
			expect(completed).toMatchObject({ id: runId, failure: null, progress: 100, kind: "export" });
			expect(["local", "s3"]).toContain(completed.artifactProvider);
			for (const timestamp of [
				completed.createdAt,
				completed.expiresAt,
				completed.startedAt,
				completed.finishedAt,
			]) {
				expect(timestamp).toEqual(expect.any(String));
				expect(Number.isNaN(Date.parse(timestamp ?? ""))).toBe(false);
			}

			const download = yield* downloadBackupArchive(owner.token, runId);
			expect(download.bytes.byteLength).toBeGreaterThan(0);
			expect(download.bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
			expect(download.headers.get("content-disposition")).toMatch(
				/^attachment; filename="ryot-backup-.+\.zip"$/,
			);

			const getError = yield* Effect.flip(
				other.client.call((c) => c.backups.getRun({ params: { id: BackupRunId.make(runId) } })),
			);
			const deleteError = yield* Effect.flip(
				other.client.call((c) => c.backups.deleteRun({ params: { id: BackupRunId.make(runId) } })),
			);
			assertTaggedError(getError, "BackupNotFound");
			assertTaggedError(deleteError, "BackupNotFound");
			expect(getError.reason).toEqual({ code: "run-not-found" });
			expect(deleteError.reason).toEqual({ code: "run-not-found" });

			const otherDownload = yield* Effect.promise(() =>
				fetch(`${getApiUrl()}/backups/runs/${runId}/download`, {
					headers: { Authorization: `Bearer ${other.token}` },
				}),
			);
			const unauthenticatedDownload = yield* Effect.promise(() =>
				fetch(`${getApiUrl()}/backups/runs/${runId}/download`),
			);
			expect(otherDownload.status).toBe(404);
			expect(unauthenticatedDownload.status).toBe(401);

			expect(
				yield* owner.client.call((c) =>
					c.backups.deleteRun({ params: { id: BackupRunId.make(runId) } }),
				),
			).toEqual({ id: runId });
			const deletedError = yield* Effect.flip(
				owner.client.call((c) => c.backups.getRun({ params: { id: BackupRunId.make(runId) } })),
			);
			assertTaggedError(deletedError, "BackupNotFound");
			expect(deletedError.reason).toEqual({ code: "run-not-found" });
			expect(
				(yield* owner.client.call((c) => c.backups.listRuns({}))).items.some(
					({ id }) => id === runId,
				),
			).toBe(false);
		}),
	);

	it.live("round-trips a schema-declared managed asset into a clean account", () =>
		Effect.gen(function* () {
			const pluginSlug = createPluginScope(`backup-assets-${crypto.randomUUID()}`);
			const schemaSlug = `backup-asset-${crypto.randomUUID()}`;
			const scriptSlug = `${pluginSlug}.fixture`;
			const entry = "scripts/fixture.sandbox.ts";
			const propertiesSchema = {
				fields: {
					title: { type: "string" as const, label: "Title", description: "Title" },
					attachment: {
						...managedAssetItemSchema,
						label: "Attachment",
						description: "Managed attachment",
					},
				},
			};
			yield* Effect.acquireRelease(
				installTestPluginBundle({
					scope: "system",
					pluginSlug,
					files: {
						[entry]: literalSandboxSource({
							value: true,
							slug: scriptSlug,
							name: "Backup asset fixture",
						}),
					},
					scripts: [
						{
							entry,
							kind: "script",
							slug: scriptSlug,
							capabilities: [],
							name: "Backup asset fixture",
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
						},
					],
					entitySchemas: [
						{
							icon: "book",
							slug: schemaSlug,
							eventSchemas: [],
							propertiesSchema,
							name: "Backup Asset Fixture",
						},
					],
				}),
				uninstallTestPlugin,
			);
			const schemaId = EntitySchemaSlug.make(schemaSlug);
			const source = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const assetBytes = new TextEncoder().encode(
				`backup managed asset ${crypto.randomUUID()}\nsecond line\n`,
			);
			const intent = yield* source.client.call((c) =>
				c.uploads.createIntent({
					payload: { kind: "permanent", contentType: "text/csv", fileName: "backup-asset.csv" },
				}),
			);
			const upload = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getApiUrl()}/`), {
					method: intent.method,
					headers: intent.headers,
					body: new Uint8Array(assetBytes),
				}),
			);
			expect([200, 204]).toContain(upload.status);
			const sourceLocator = yield* source.client.call((c) =>
				c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
			);
			if (!("key" in sourceLocator)) {
				throw new Error("Expected a permanent asset locator");
			}

			const title = `Backup asset entity ${crypto.randomUUID()}`;
			const sourceEntity = yield* createEntity(source.client, {
				name: title,
				entitySchemaSlug: schemaId,
				properties: { title, attachment: sourceLocator },
			});
			expect((yield* getEntity(source.client, sourceEntity.id)).properties).toEqual({
				title,
				attachment: sourceLocator,
			});

			const sourceOwnershipError = yield* Effect.flip(
				other.client.call((c) =>
					c.uploads.resolveDownloads({ payload: { assets: [sourceLocator] } }),
				),
			);
			assertTaggedError(sourceOwnershipError, "UploadBadRequest");

			const { bytes: archive } = yield* exportAndDownloadBackup(source.client, source.token);
			yield* deleteUserAndWait(source.userId);

			const target = yield* createAuthenticatedClient();
			const restore = yield* restoreBackup(target.client, archive);
			if (restore.run.status !== "completed") {
				throw new Error(
					`Backup restore '${restore.id}' failed with ${restore.run.failure?.code ?? "unknown"}`,
				);
			}
			const restoredEntity = yield* getEntity(target.client, sourceEntity.id);
			const targetLocator = yield* Schema.decodeUnknownEffect(ManagedAssetLocator)(
				restoredEntity.properties.attachment,
			);

			expect(restoredEntity.id).toBe(sourceEntity.id);
			expect(restoredEntity.name).toBe(sourceEntity.name);
			expect(restoredEntity.entitySchemaSlug).toBe(schemaId);
			expect(restoredEntity.properties).toEqual({ title, attachment: targetLocator });
			expect(targetLocator.type).toBe("s3");
			expect(targetLocator.key).not.toBe(sourceLocator.key);

			const targetOwnershipError = yield* Effect.flip(
				other.client.call((c) =>
					c.uploads.resolveDownloads({ payload: { assets: [targetLocator] } }),
				),
			);
			assertTaggedError(targetOwnershipError, "UploadBadRequest");
			const resolved = yield* target.client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [targetLocator] } }),
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0]?.asset).toEqual(targetLocator);
			expect(resolved[0]?.expiresAt).toEqual(expect.any(String));
			expect(Number.isNaN(Date.parse(resolved[0]?.expiresAt ?? ""))).toBe(false);
			const targetDownload = yield* Effect.promise(() =>
				fetch(new URL(resolved[0]?.downloadUrl ?? "", `${getApiUrl()}/`)),
			);
			expect(targetDownload.status).toBe(200);
			expect(new Uint8Array(yield* Effect.promise(() => targetDownload.arrayBuffer()))).toEqual(
				assetBytes,
			);
		}),
	);
});
