import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	adminHeaders,
	createSandboxScript,
	enqueueSandboxScript,
	findBuiltinSchemaWithProviders,
	forbiddenImportSandboxSource,
	getFirstProviderScriptId,
	getBackendClient,
	nonStaticManifestSandboxSource,
	pollSandboxResult,
	queryEngineSandboxSource,
	undeclaredHostSandboxSource,
} from "~/fixtures";
import { assertCompleted, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox enqueue by script ID", () => {
	it.live("returns 404 when the scriptId does not exist", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.sandbox.enqueue({
						payload: { driverName: "main", scriptId: SandboxScriptId.make(crypto.randomUUID()) },
					}),
				),
			);

			assertTaggedError(error, "NotFound");
		}),
	);

	it.live("enqueues a built-in script and reaches a terminal state", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaWithProviders(client);
			const searchScriptId = getFirstProviderScriptId(schema);

			const { jobId } = yield* enqueueSandboxScript(client, {
				driverName: "search",
				scriptId: searchScriptId,
				context: { page: 1, pageSize: 5, query: "test" },
			});

			const result = yield* pollSandboxResult(client, jobId);
			expect(result.status).not.toBe("pending");
		}),
	);

	it.live("rejects undeclared host usage while creating the script", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const slug = `no-host-functions-${crypto.randomUUID()}`;
			const source = undeclaredHostSandboxSource({ name: "no-host-functions", slug });
			const error = yield* Effect.flip(
				client.call((c) => c.sandbox.createScript({ payload: { source } })),
			);

			assertTaggedError(error, "SandboxCompilationFailure");
			expect(error.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						severity: "error",
						message: expect.stringContaining("executeQueryEngine"),
					}),
				]),
			);
		}),
	);

	it.live("rejects a non-static manifest while creating the script", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const slug = `non-static-manifest-${crypto.randomUUID()}`;
			const source = nonStaticManifestSandboxSource({ name: "Non-static manifest", slug });
			const error = yield* Effect.flip(
				client.call((c) => c.sandbox.createScript({ payload: { source } })),
			);

			assertTaggedError(error, "SandboxCompilationFailure");
			expect(error.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "RYOT_MANIFEST",
						message: "The exported manifest must not have an explicit type annotation",
					}),
				]),
			);
		}),
	);

	it.live("rejects a direct package import while creating the script", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const slug = `forbidden-import-${crypto.randomUUID()}`;
			const source = forbiddenImportSandboxSource({ name: "Forbidden import", slug });
			const error = yield* Effect.flip(
				client.call((c) => c.sandbox.createScript({ payload: { source } })),
			);

			assertTaggedError(error, "SandboxCompilationFailure");
			expect(error.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "RYOT_IMPORT",
						message: expect.stringContaining('Import "zod" is not allowed'),
					}),
				]),
			);
		}),
	);

	it.live("rejects persisted capability tampering at runtime", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const slug = `persisted-capabilities-${crypto.randomUUID()}`;
			const { id: scriptId } = yield* createSandboxScript(client, {
				source: queryEngineSandboxSource({
					name: "persisted-capabilities",
					slug,
					query: {
						source: {
							where: null,
							alias: "entity",
							type: "entities",
							schemas: ["movie"],
						},
						output: {
							fields: [],
							type: "rows",
							pagination: { page: 1, limit: 1 },
							orderBy: [
								{
									order: "asc",
									expr: {
										type: "ref",
										sourceAlias: "entity",
										field: { type: "system", name: "name" },
									},
								},
							],
						},
					},
				}),
			});
			const stored = yield* getBackendClient().call(
				(c) =>
					c.testSupport.getSandboxScript({ path: { scriptId: SandboxScriptId.make(scriptId) } }),
				adminHeaders,
			);
			yield* getBackendClient().call(
				(c) =>
					c.testSupport.patchSandboxScript({
						path: { scriptId: SandboxScriptId.make(scriptId) },
						payload: { metadata: { ...stored.metadata, capabilities: [] } },
					}),
				adminHeaders,
			);

			const { jobId } = yield* enqueueSandboxScript(client, { scriptId, driverName: "main" });

			const result = yield* pollSandboxResult(client, jobId);
			assertCompleted(result, "sandbox job");

			expect(result.error).toMatchObject({
				phase: "load",
				message: "Compiled sandbox manifest does not match persisted metadata",
			});
		}),
	);
});
