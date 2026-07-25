import { Effect } from "effect";

import {
	createAuthenticatedClient,
	FIXTURE_CONFIG_IMPORT_SOURCE,
	FIXTURE_HANDLE_IMPORT_SOURCE,
	FIXTURE_IMPORT_SOURCE,
	installTestImportPlugin,
	installTestImportPinningPlugin,
	installTestHarvestHandleImportPlugin,
	pollImportRunUntilTerminal,
	pollUntil,
	postBackendJson,
	type InstalledTestPlugin,
	uninstallTestPluginStrict,
	uploadImportFile,
} from "~/fixtures";
import { assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

let fixtureImportPlugin: InstalledTestPlugin | undefined;

const uninstallWhenReleased = (installed: InstalledTestPlugin) =>
	pollUntil(
		`uninstall of '${installed.pluginSlug}' after import completion`,
		uninstallTestPluginStrict(installed).pipe(
			Effect.as(true),
			Effect.catchTag("Conflict", () => Effect.succeed(null)),
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

	it.live("runs an installed source absent from the central contract to terminal success", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				cookies,
				"name,value\nfixture,1\n",
				"fixture-archive.csv",
				"text/csv",
			);
			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
			);

			const completed = yield* pollImportRunUntilTerminal(client, created.id);
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

	it.live("pins an accepted plugin import until terminal completion", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { plugin, source } = yield* Effect.acquireRelease(
				installTestImportPinningPlugin,
				({ plugin: installedPlugin }) =>
					uninstallWhenReleased(installedPlugin).pipe(Effect.asVoid, Effect.orDie),
			);

			const created = yield* client.call((c) => c.imports.createRun({ payload: { source } }));

			const conflict = yield* Effect.flip(uninstallTestPluginStrict(plugin));
			assertTaggedError(conflict, "Conflict");

			const completed = yield* pollImportRunUntilTerminal(client, created.id);
			expect(completed).toMatchObject({
				source,
				progress: 100,
				failedItems: 0,
				importedItems: 0,
				processedItems: 0,
				status: "completed",
			});
			expect(completed.finishedAt).not.toBeNull();

			expect(yield* uninstallWhenReleased(plugin)).toBe(true);
		}),
	);

	it.live("resolves opaque harvest handles at kernel chunk consumption", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* Effect.acquireRelease(installTestHarvestHandleImportPlugin, (installed) =>
				uninstallWhenReleased(installed).pipe(Effect.asVoid, Effect.orDie),
			);

			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_HANDLE_IMPORT_SOURCE } }),
			);
			const completed = yield* pollImportRunUntilTerminal(client, created.id);

			expect(completed).toMatchObject({
				failedItems: 1,
				status: "failed",
				processedItems: 1,
				source: FIXTURE_HANDLE_IMPORT_SOURCE,
			});
			expect(completed.errorSummary).toBe("harvest handle fixture failure");
		}),
	);

	it.live("rejects malformed import payloads", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const response = yield* Effect.promise(() => postBackendJson("/imports/runs", [], cookies));

			expect(response.status).toBe(400);
		}),
	);

	it.live("rejects upload-token fields not declared by the selected source", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const [archiveUploadToken, undeclaredUploadToken] = yield* Effect.all([
				uploadImportFile(cookies, "fixture", "fixture.csv", "text/csv"),
				uploadImportFile(cookies, "other", "other.csv", "text/csv"),
			]);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { archiveUploadToken, undeclaredUploadToken, source: FIXTURE_IMPORT_SOURCE },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects internal dispatch and artifact path fields before claiming uploads", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				cookies,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const integrationError = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: {
							source: FIXTURE_IMPORT_SOURCE,
							archiveUploadToken,
							integrationScriptSlug: "integration.spoofed",
						},
					}),
				),
			);
			assertTaggedError(integrationError, "BadRequest");

			const artifactPathError = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: {
							source: FIXTURE_IMPORT_SOURCE,
							archiveUploadToken,
							archiveFilePath: "/tmp/unclaimed.csv",
						},
					}),
				),
			);
			assertTaggedError(artifactPathError, "BadRequest");

			const created = yield* client.call((c) =>
				c.imports.createRun({
					payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken },
				}),
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

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects an invalid named artifact extension", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				cookies,
				"fixture",
				"fixture.json",
				"application/json",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken },
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects an unknown source before claiming uploads or starting a workflow", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				cookies,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({
						payload: { source: "e2e_missing_import_source", archiveUploadToken },
					}),
				),
			);
			assertTaggedError(error, "BadRequest");
			expect(yield* client.call((c) => c.imports.listRuns())).toEqual([]);

			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
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

			assertTaggedError(error, "BadRequest");
		}),
	);

	it.live("rejects an inactive source before claiming uploads or starting a workflow", () =>
		Effect.gen(function* () {
			assertPresent(fixtureImportPlugin, "Fixture import plugin is missing");
			yield* uninstallWhenReleased(fixtureImportPlugin);

			const { client, cookies } = yield* createAuthenticatedClient();
			const archiveUploadToken = yield* uploadImportFile(
				cookies,
				"fixture",
				"fixture.csv",
				"text/csv",
			);
			const error = yield* Effect.flip(
				client.call((c) =>
					c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
				),
			);
			assertTaggedError(error, "BadRequest");
			expect(yield* client.call((c) => c.imports.listRuns())).toEqual([]);

			fixtureImportPlugin = yield* installTestImportPlugin;
			const created = yield* client.call((c) =>
				c.imports.createRun({ payload: { source: FIXTURE_IMPORT_SOURCE, archiveUploadToken } }),
			);
			expect((yield* pollImportRunUntilTerminal(client, created.id)).status).toBe("completed");
		}),
	);
});
