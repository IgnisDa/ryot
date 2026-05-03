import { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import { managedAssetItemSchema } from "@ryot/contract/schema/core";
import { Effect, Schema } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createPluginScope,
	downloadBackupArchive,
	exportAndDownloadBackup,
	getBackendClient,
	getEntity,
	pollBackupRunUntilTerminal,
	restoreBackup,
	startBackupExport,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { getBackendUrl } from "~/support/backend";
import { describe, expect, it } from "~/support/effect-test";

describe("backup lifecycle", () => {
	it.live("exports, isolates, downloads, and deletes a completed backup", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const runId = yield* startBackupExport(owner.client);
			const completed = yield* pollBackupRunUntilTerminal(owner.client, runId);
			if (completed.status !== "completed") {
				throw new Error(`Backup export '${runId}' failed: ${completed.error ?? "unknown error"}`);
			}

			const fetched = yield* owner.client.call((c) =>
				c.backups.getRun({ params: { id: BackupRunId.make(runId) } }),
			);
			const listed = yield* owner.client.call((c) => c.backups.listRuns({}));

			expect(fetched).toEqual(completed);
			expect(listed.items.find(({ id }) => id === runId)).toEqual(completed);
			expect(completed).toMatchObject({
				id: runId,
				error: null,
				kind: "export",
				progress: 100,
			});
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

			const download = yield* downloadBackupArchive(owner.cookies, runId);
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
			assertTaggedError(getError, "NotFound");
			assertTaggedError(deleteError, "NotFound");

			const otherDownload = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/backups/runs/${runId}/download`, {
					headers: { Cookie: other.cookies },
				}),
			);
			const unauthenticatedDownload = yield* Effect.promise(() =>
				fetch(`${getBackendUrl()}/backups/runs/${runId}/download`),
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
			assertTaggedError(deletedError, "NotFound");
			expect(
				(yield* owner.client.call((c) => c.backups.listRuns({}))).items.some(
					({ id }) => id === runId,
				),
			).toBe(false);
		}),
	);

	it.live("round-trips a schema-declared local managed asset into a clean account", () =>
		Effect.gen(function* () {
			const source = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const pluginSlug = createPluginScope(`backup-assets-${crypto.randomUUID()}`);
			const schemaSlug = `backup-asset-${crypto.randomUUID()}`;
			const { schemaId } = yield* createEntitySchema(source.client, {
				pluginSlug,
				slug: schemaSlug,
				name: "Backup Asset Fixture",
				propertiesSchema: {
					fields: {
						title: { type: "string", label: "Title", description: "Title" },
						attachment: {
							...managedAssetItemSchema,
							label: "Attachment",
							description: "Managed attachment",
						},
					},
				},
			});
			const assetBytes = new TextEncoder().encode(
				`backup managed asset ${crypto.randomUUID()}\nsecond line\n`,
			);
			const intent = yield* source.client.call((c) =>
				c.uploads.createIntent({
					payload: {
						kind: "permanent",
						provider: "local",
						contentType: "text/csv",
						fileName: "backup-asset.csv",
					},
				}),
			);
			const upload = yield* Effect.promise(() =>
				fetch(new URL(intent.uploadUrl, `${getBackendUrl()}/`), {
					method: intent.method,
					headers: intent.headers,
					body: new Uint8Array(assetBytes),
				}),
			);
			expect([200, 204]).toContain(upload.status);
			const sourceLocator = yield* source.client.call((c) =>
				c.uploads.completeIntent({ params: { intentId: intent.intentId } }),
			);
			if (!("key" in sourceLocator) || sourceLocator.type !== "local") {
				throw new Error("Expected a permanent local asset locator");
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
			assertTaggedError(sourceOwnershipError, "BadRequest");

			const { bytes: archive } = yield* exportAndDownloadBackup(source.client, source.cookies);
			yield* getBackendClient().call(
				(c) => c.godMode.deleteUser({ params: { userId: UserId.make(source.userId) } }),
				adminHeaders,
			);

			const target = yield* createAuthenticatedClient();
			const restore = yield* restoreBackup(target.client, archive);
			if (restore.run.status !== "completed") {
				throw new Error(
					`Backup restore '${restore.id}' failed: ${restore.run.error ?? "unknown error"}`,
				);
			}
			const restoredEntity = yield* getEntity(target.client, sourceEntity.id);
			const targetLocator = yield* Schema.decodeUnknownEffect(ManagedAssetLocator)(
				restoredEntity.properties.attachment,
			);

			expect(restoredEntity.id).toBe(sourceEntity.id);
			expect(restoredEntity.name).toBe(sourceEntity.name);
			expect(restoredEntity.entitySchemaSlug).toBe(schemaId);
			expect(restoredEntity.properties).toEqual({
				title,
				attachment: targetLocator,
			});
			expect(targetLocator.type).toBe("local");
			expect(targetLocator.key).not.toBe(sourceLocator.key);

			const targetOwnershipError = yield* Effect.flip(
				other.client.call((c) =>
					c.uploads.resolveDownloads({ payload: { assets: [targetLocator] } }),
				),
			);
			assertTaggedError(targetOwnershipError, "BadRequest");
			const resolved = yield* target.client.call((c) =>
				c.uploads.resolveDownloads({ payload: { assets: [targetLocator] } }),
			);
			expect(resolved).toHaveLength(1);
			expect(resolved[0]?.asset).toEqual(targetLocator);
			const targetDownload = yield* Effect.promise(() =>
				fetch(new URL(resolved[0]?.downloadUrl ?? "", `${getBackendUrl()}/`)),
			);
			expect(targetDownload.status).toBe(200);
			expect(new Uint8Array(yield* Effect.promise(() => targetDownload.arrayBuffer()))).toEqual(
				assetBytes,
			);
		}),
	);
});
