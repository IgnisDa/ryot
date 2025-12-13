import { describe, expect, it } from "bun:test";

import { SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	findBuiltinSchemaWithProviders,
	forbiddenImportSandboxSource,
	getFirstProviderScriptId,
	nonStaticManifestSandboxSource,
	pollSandboxResult,
	queryEngineSandboxSource,
	undeclaredHostSandboxSource,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertCompleted, assertTaggedError } from "../test-support/assertions";

describe("sandbox enqueue by script ID", () => {
	it("returns 404 when the scriptId does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.sandbox.enqueue({
				payload: { driverName: "main", scriptId: SandboxScriptId.make(crypto.randomUUID()) },
			}),
		);

		assertTaggedError(error, "NotFound");
	});

	it("enqueues a built-in script and reaches a terminal state", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const searchScriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueSandboxScript(client, {
			driverName: "search",
			scriptId: searchScriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const result = await pollSandboxResult(client, jobId);
		expect(result.status).not.toBe("pending");
	});

	it("rejects undeclared host usage while creating the script", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `no-host-functions-${crypto.randomUUID()}`;
		const source = undeclaredHostSandboxSource({ name: "no-host-functions", slug });
		const error = await client.runError((c) => c.sandbox.createScript({ payload: { source } }));

		assertTaggedError(error, "SandboxCompilationFailure");
		expect(error.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					message: expect.stringContaining("executeQueryEngine"),
				}),
			]),
		);
	});

	it("rejects a non-static manifest while creating the script", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `non-static-manifest-${crypto.randomUUID()}`;
		const source = nonStaticManifestSandboxSource({ name: "Non-static manifest", slug });
		const error = await client.runError((c) => c.sandbox.createScript({ payload: { source } }));

		assertTaggedError(error, "SandboxCompilationFailure");
		expect(error.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "RYOT_MANIFEST",
					message: "The exported manifest must not have an explicit type annotation",
				}),
			]),
		);
	});

	it("rejects a direct package import while creating the script", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `forbidden-import-${crypto.randomUUID()}`;
		const source = forbiddenImportSandboxSource({ name: "Forbidden import", slug });
		const error = await client.runError((c) => c.sandbox.createScript({ payload: { source } }));

		assertTaggedError(error, "SandboxCompilationFailure");
		expect(error.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "RYOT_IMPORT",
					message: expect.stringContaining('Import "zod" is not allowed'),
				}),
			]),
		);
	});

	it("rejects persisted capability tampering at runtime", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `persisted-capabilities-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
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
		await getPgClient().query(
			`update sandbox_script
			 set metadata = jsonb_set(metadata, '{capabilities}', '[]'::jsonb)
			 where id = $1`,
			[scriptId],
		);

		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);
		assertCompleted(result, "sandbox job");

		expect(result.error).toMatchObject({
			phase: "load",
			message: "Compiled sandbox manifest does not match persisted metadata",
		});
	});
});
