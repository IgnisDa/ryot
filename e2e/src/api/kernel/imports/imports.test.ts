import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { importSourcesRecipe } from "@ryot-app/ryotql-recipes/import-sources";
import { Effect, Schema } from "effect";

import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	FIXTURE_CONFIG_IMPORT_SOURCE,
	FIXTURE_HANDLE_IMPORT_SOURCE,
	FIXTURE_IMPORT_SOURCE,
	installTestImportPlugin,
	installTestImportPinningPlugin,
	installTestPartialResultCancellationImportPlugin,
	installTestHarvestHandleImportPlugin,
	getImportRun,
	importIssuesExportSchema,
	listImportedEntityNames,
	listManualImportRuns,
	pollImportRunUntilTerminal,
	pollUntil,
	postApiJson,
	type InstalledTestPlugin,
	uninstallTestPlugin,
	uninstallTestPluginStrict,
	uploadImportFile,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { getApiUrl } from "~/support/harness-target";
import { webRequest } from "~/support/web-request";

let fixtureImportPlugin: InstalledTestPlugin | undefined;

const uninstallWhenReleased = (installed: InstalledTestPlugin) =>
	pollUntil(
		`uninstall of '${installed.pluginSlug}' after import completion`,
		uninstallTestPluginStrict(installed).pipe(
			Effect.as(true),
			Effect.catchTag("PluginConflictError", (error) =>
				error.reason.code === "workflow-referenced" ? Effect.succeed(null) : Effect.fail(error),
			),
		),
	);

describe("Plugin Import Public Boundary", () => {
	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				fixtureImportPlugin = yield* installTestImportPlugin;
			}),
		),
	);

	afterAll(() => fixtureImportPlugin && runPromise(uninstallWhenReleased(fixtureImportPlugin)));

	it.live("lists authenticated manifest sources with start availability", () =>
		Effect.gen(function* () {
			assertPresent(fixtureImportPlugin, "Fixture import plugin is missing");
			const { client } = yield* createAuthenticatedClient();
			const sources = yield* collectRyotQLRecipeItems(client, (after) =>
				importSourcesRecipe({ after, limit: 100 }),
			);
			const fixtureSource = fixtureImportPlugin.manifest.importSources.find(
				({ slug }) => slug === FIXTURE_IMPORT_SOURCE,
			);
			const configSource = fixtureImportPlugin.manifest.importSources.find(
				({ slug }) => slug === FIXTURE_CONFIG_IMPORT_SOURCE,
			);
			assertPresent(fixtureSource, "Fixture import source declaration is missing");
			assertPresent(configSource, "Fixture config import source declaration is missing");

			expect(sources.find(({ slug }) => slug === FIXTURE_IMPORT_SOURCE)).toMatchObject({
				...fixtureSource,
				isStartable: true,
				missingPluginConfigKeys: [],
				pluginSlug: fixtureImportPlugin.pluginSlug,
			});
			expect(sources.find(({ slug }) => slug === FIXTURE_CONFIG_IMPORT_SOURCE)).toMatchObject({
				...configSource,
				isStartable: false,
				pluginSlug: fixtureImportPlugin.pluginSlug,
				missingPluginConfigKeys: [
					pluginConfigEnvironmentKey(fixtureImportPlugin.pluginSlug, "fixtureToken"),
				],
			});
		}),
	);

	it.live("runs an installed source absent from the central contract to terminal success", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				token,
				"name,value\nfixture,1\n",
				"fixture-archive.csv",
				"text/csv",
			);
			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { archiveUploadToken, source: FIXTURE_IMPORT_SOURCE } }),
			);

			const completed = yield* pollImportRunUntilTerminal(client, created.id);
			expect(completed.failureReason).toBeNull();
			expect(completed).toMatchObject({
				summary: [],
				status: "completed",
				source: FIXTURE_IMPORT_SOURCE,
			});
			expect(completed.finishedAt).not.toBeNull();
		}),
	);

	it.live("fails an in-flight import when its plugin is uninstalled", () =>
		Effect.gen(function* () {
			const { plugin, source } = yield* Effect.acquireRelease(
				installTestImportPinningPlugin,
				({ plugin: installedPlugin }) =>
					uninstallWhenReleased(installedPlugin).pipe(Effect.asVoid, Effect.orDie),
			);
			const { client } = yield* createAuthenticatedClient();

			const created = yield* client.call((c) => c.imports.createRun({ payload: { source } }));

			yield* uninstallTestPluginStrict(plugin);

			const completed = yield* pollImportRunUntilTerminal(client, created.id);
			expect(completed).toMatchObject({ source, summary: [], status: "failed" });
			expect(completed.finishedAt).not.toBeNull();
		}),
	);

	it.live("lets an authenticated owner repeatedly cancel and delete an active import", () =>
		Effect.gen(function* () {
			const { source } = yield* Effect.acquireRelease(
				installTestImportPinningPlugin,
				({ plugin: installedPlugin }) =>
					uninstallWhenReleased(installedPlugin).pipe(Effect.asVoid, Effect.orDie),
			);
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const created = yield* owner.client.call((c) => c.imports.createRun({ payload: { source } }));
			yield* pollUntil(
				`Import run '${created.id}' to start`,
				Effect.gen(function* () {
					const run = (yield* getImportRun(owner.client, created.id, undefined, 10)).run;
					return run?.status === "running" ? true : null;
				}),
			);

			const foreignError = yield* Effect.flip(
				other.client.call((c) =>
					c.imports.cancelRun({ params: { runId: ImportRunId.make(created.id) } }),
				),
			);
			assertTaggedError(foreignError, "ImportNotFoundError");

			const first = yield* owner.client.call((c) =>
				c.imports.cancelRun({ params: { runId: ImportRunId.make(created.id) } }),
			);
			const repeated = yield* owner.client.call((c) =>
				c.imports.cancelRun({ params: { runId: ImportRunId.make(created.id) } }),
			);
			expect(first.id).toBe(created.id);
			expect(repeated.id).toBe(created.id);

			const cancelled = yield* pollImportRunUntilTerminal(owner.client, created.id);
			expect(cancelled).toMatchObject({ summary: [], status: "cancelled", failureReason: null });
			expect(cancelled.finishedAt).not.toBeNull();

			yield* owner.client.call((c) =>
				c.imports.deleteRun({ params: { runId: ImportRunId.make(created.id) } }),
			);
			expect((yield* getImportRun(owner.client, created.id, undefined, 10)).run).toBeUndefined();
		}),
	);

	it.live("cancels a newly accepted import before it can finish", () =>
		Effect.gen(function* () {
			const { source } = yield* Effect.acquireRelease(
				installTestImportPinningPlugin,
				({ plugin: installedPlugin }) =>
					uninstallWhenReleased(installedPlugin).pipe(Effect.asVoid, Effect.orDie),
			);
			const { client } = yield* createAuthenticatedClient();
			const created = yield* client.call((c) => c.imports.createRun({ payload: { source } }));
			yield* client.call((c) =>
				c.imports.cancelRun({ params: { runId: ImportRunId.make(created.id) } }),
			);
			expect((yield* pollImportRunUntilTerminal(client, created.id)).status).toBe("cancelled");
		}),
	);

	it.live("retains committed partial results and their checkpoint when cancelled", () =>
		Effect.gen(function* () {
			const fixture = yield* Effect.acquireRelease(
				installTestPartialResultCancellationImportPlugin,
				({ plugin }) => uninstallTestPlugin(plugin),
			);
			const { client } = yield* createAuthenticatedClient();
			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: fixture.source } }),
			);
			const checkpoint = yield* pollUntil(
				`Import run '${created.id}' to persist its ten-item checkpoint`,
				Effect.gen(function* () {
					const run = (yield* getImportRun(client, created.id, undefined, 10)).run;
					return run?.status === "running" &&
						run.summary.some(
							({ unit, counts, recordKind }) =>
								unit === "records" &&
								recordKind === "record" &&
								counts.created === 10 &&
								counts.unsuccessful === 0,
						)
						? run
						: null;
				}),
			);

			yield* client.call((c) =>
				c.imports.cancelRun({ params: { runId: ImportRunId.make(created.id) } }),
			);
			const cancelled = yield* pollImportRunUntilTerminal(client, created.id);
			expect(cancelled).toMatchObject({
				status: "cancelled",
				failureReason: null,
				summary: checkpoint.summary,
			});

			const entityNames = yield* listImportedEntityNames(client, fixture.entitySchemaSlug);
			expect(entityNames).toEqual(fixture.committedNames);
			expect(entityNames).not.toContain(fixture.blockedName);
			expect(entityNames).not.toContain(fixture.laterName);
		}),
	);

	it.live("downloads every stored import failure for the owning user", () =>
		Effect.gen(function* () {
			yield* Effect.acquireRelease(installTestHarvestHandleImportPlugin(101), (installed) =>
				uninstallWhenReleased(installed).pipe(Effect.asVoid, Effect.orDie),
			);
			const { client } = yield* createAuthenticatedClient();

			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_HANDLE_IMPORT_SOURCE } }),
			);
			const completed = yield* pollImportRunUntilTerminal(client, created.id);

			expect(completed.failureReason).toBeNull();
			expect(completed).toMatchObject({
				status: "completed",
				source: FIXTURE_HANDLE_IMPORT_SOURCE,
				summary: [
					{
						unit: "records",
						recordKind: "record",
						counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 101 },
					},
				],
			});

			const ticket = yield* client.call((c) =>
				c.imports.createFailuresDownloadTicket({ params: { runId: ImportRunId.make(created.id) } }),
			);
			const downloadUrl = `${getApiUrl()}${ticket.url}`;
			const response = yield* webRequest(downloadUrl);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
			expect(response.headers.get("content-disposition")).toContain(
				`ryot-import-issues-${created.id}.json`,
			);
			const report = yield* Schema.decodeUnknownEffect(importIssuesExportSchema)(
				yield* Effect.promise(() => response.json()),
			);
			expect(report.runId).toBe(created.id);
			expect(report.issues).toHaveLength(101);
			expect(report.issues.map(({ attribution }) => attribution?.sourceLabel)).toContain(
				"Harvest fixture 101",
			);

			const other = yield* createAuthenticatedClient();
			const foreignTicket = yield* Effect.flip(
				other.client.call((c) =>
					c.imports.createFailuresDownloadTicket({
						params: { runId: ImportRunId.make(created.id) },
					}),
				),
			);
			assertTaggedError(foreignTicket, "ImportNotFoundError");
			const invalidTicket = yield* webRequest(
				`${getApiUrl()}/imports/runs/${encodeURIComponent(created.id)}/failures/download?ticket=invalid`,
			);
			expect(invalidTicket.status).toBe(404);
		}),
	);

	it.live("rejects malformed import payloads", () =>
		Effect.gen(function* () {
			const { token } = yield* createAuthenticatedClient();
			const response = yield* postApiJson("/imports/runs", [], token);

			expect(response.status).toBe(400);
		}),
	);

	it.live("rejects upload-token fields not declared by the selected source", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const [archiveUploadToken, undeclaredUploadToken] = yield* Effect.all([
				uploadImportFile(token, "fixture", "fixture.csv", "text/csv"),
				uploadImportFile(token, "other", "other.csv", "text/csv"),
			]);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { archiveUploadToken, undeclaredUploadToken, source: FIXTURE_IMPORT_SOURCE },
					}),
				),
			);

			assertTaggedError(error, "ImportRequestError");
			expect(error.reason).toEqual({ field: null, code: "invalid-input" });
		}),
	);

	it.live("rejects reserved and schema-invalid fields before claiming uploads", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				token,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const integrationError = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: {
							archiveUploadToken,
							source: FIXTURE_IMPORT_SOURCE,
							integrationScriptSlug: "integration.spoofed",
						},
					}),
				),
			);
			assertTaggedError(integrationError, "ImportRequestError");
			expect(integrationError.reason).toEqual({ field: null, code: "invalid-input" });

			const schemaError = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: {
							source: FIXTURE_IMPORT_SOURCE,
							archiveUploadToken: {
								token: archiveUploadToken,
								expiresAt: "2026-08-23T00:00:00.000Z",
							},
						},
					}),
				),
			);
			assertTaggedError(schemaError, "ImportRequestError");

			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { archiveUploadToken, source: FIXTURE_IMPORT_SOURCE } }),
			);
			expect((yield* pollImportRunUntilTerminal(client, created.id)).status).toBe("completed");
		}),
	);

	it.live("rejects a missing required named artifact", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const error = yield* Effect.flip(
				client.call((c) => c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE } })),
			);

			assertTaggedError(error, "ImportRequestError");
		}),
	);

	it.live("rejects an invalid named artifact extension", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				token,
				"fixture",
				"fixture.json",
				"application/json",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({ payload: { archiveUploadToken, source: FIXTURE_IMPORT_SOURCE } }),
				),
			);

			assertTaggedError(error, "ImportRequestError");
		}),
	);

	it.live("rejects an unknown source before claiming uploads or starting a workflow", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				token,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { archiveUploadToken, source: "e2e_missing_import_source" },
					}),
				),
			);
			assertTaggedError(error, "ImportRequestError");
			expect((yield* listManualImportRuns(client, undefined, 20)).items).toEqual([]);

			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { archiveUploadToken, source: FIXTURE_IMPORT_SOURCE } }),
			);
			expect((yield* pollImportRunUntilTerminal(client, created.id)).status).toBe("completed");
		}),
	);

	it.live("rejects a source whose required plugin config is absent", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({ payload: { source: FIXTURE_CONFIG_IMPORT_SOURCE } }),
				),
			);

			assertTaggedError(error, "ImportRequestError");
		}),
	);

	it.live("rejects an inactive source before claiming uploads or starting a workflow", () =>
		Effect.gen(function* () {
			assertPresent(fixtureImportPlugin, "Fixture import plugin is missing");
			yield* uninstallWhenReleased(fixtureImportPlugin);

			const { token, client } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				token,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({ payload: { archiveUploadToken, source: FIXTURE_IMPORT_SOURCE } }),
				),
			);
			assertTaggedError(error, "ImportRequestError");
			expect((yield* listManualImportRuns(client, undefined, 20)).items).toEqual([]);

			fixtureImportPlugin = yield* installTestImportPlugin;
			const reinstalled = yield* createAuthenticatedClient();
			const reinstalledToken = yield* uploadImportFile(
				reinstalled.token,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const created = yield* reinstalled.client.call((c) =>
				c.imports.createRun({
					payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken: reinstalledToken },
				}),
			);
			expect((yield* pollImportRunUntilTerminal(reinstalled.client, created.id)).status).toBe(
				"completed",
			);
		}),
	);
});
