import type { ContractSuccess } from "@ryot-app/contract/client";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	FIXTURE_CONFIG_IMPORT_SOURCE,
	FIXTURE_HANDLE_IMPORT_SOURCE,
	FIXTURE_IMPORT_SOURCE,
	installTestImportPlugin,
	installTestImportPinningPlugin,
	installTestHarvestHandleImportPlugin,
	listManualImportRuns,
	pollImportRunUntilTerminal,
	pollUntil,
	postApiJson,
	type InstalledTestPlugin,
	uninstallTestPluginStrict,
	uploadImportFile,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

let fixtureImportPlugin: InstalledTestPlugin | undefined;

type ListedImportSource = ContractSuccess<"imports", "listSources">[number];

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
	beforeAll(async () => {
		fixtureImportPlugin = await Effect.runPromise(installTestImportPlugin);
	});

	afterAll(async () => {
		if (fixtureImportPlugin) {
			await Effect.runPromise(uninstallWhenReleased(fixtureImportPlugin));
		}
	});

	it.live("lists authenticated manifest sources with start availability", () =>
		Effect.gen(function* () {
			assertPresent(fixtureImportPlugin, "Fixture import plugin is missing");
			const { client } = yield* createAuthenticatedClient();
			const sources = yield* client.call((c) => c.imports.listSources());
			const fixtureSource = fixtureImportPlugin.manifest.importSources.find(
				({ slug }) => slug === FIXTURE_IMPORT_SOURCE,
			);
			const configSource = fixtureImportPlugin.manifest.importSources.find(
				({ slug }) => slug === FIXTURE_CONFIG_IMPORT_SOURCE,
			);
			assertPresent(fixtureSource, "Fixture import source declaration is missing");
			assertPresent(configSource, "Fixture config import source declaration is missing");

			expect(sources.find(({ slug }) => slug === FIXTURE_IMPORT_SOURCE)).toEqual({
				...fixtureSource,
				isStartable: true,
				missingPluginConfigKeys: [],
				pluginSlug: fixtureImportPlugin.pluginSlug,
			} satisfies ListedImportSource);
			expect(sources.find(({ slug }) => slug === FIXTURE_CONFIG_IMPORT_SOURCE)).toEqual({
				...configSource,
				isStartable: false,
				pluginSlug: fixtureImportPlugin.pluginSlug,
				missingPluginConfigKeys: [
					pluginConfigEnvironmentKey(fixtureImportPlugin.pluginSlug, "fixtureToken"),
				],
			} satisfies ListedImportSource);
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
				progress: 100,
				failedItems: 0,
				importedItems: 0,
				processedItems: 0,
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
			expect(completed).toMatchObject({
				source,
				progress: 0,
				failedItems: 0,
				status: "failed",
				importedItems: 0,
				processedItems: 0,
			});
			expect(completed.finishedAt).not.toBeNull();
		}),
	);

	it.live("resolves workflow-lifetime opaque harvest handles", () =>
		Effect.gen(function* () {
			yield* Effect.acquireRelease(installTestHarvestHandleImportPlugin, (installed) =>
				uninstallWhenReleased(installed).pipe(Effect.asVoid, Effect.orDie),
			);
			const { client } = yield* createAuthenticatedClient();

			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_HANDLE_IMPORT_SOURCE } }),
			);
			const completed = yield* pollImportRunUntilTerminal(client, created.id);

			expect(completed.failureReason).toEqual({ code: "input-transformation-failed" });
			expect(completed).toMatchObject({
				failedItems: 1,
				status: "failed",
				processedItems: 1,
				source: FIXTURE_HANDLE_IMPORT_SOURCE,
			});
		}),
	);

	it.live("rejects malformed import payloads", () =>
		Effect.gen(function* () {
			const { token } = yield* createAuthenticatedClient();
			const response = yield* Effect.promise(() => postApiJson("/imports/runs", [], token));

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
