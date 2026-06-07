import { describe, expect, it } from "bun:test";

import { SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	findBuiltinSchemaWithProviders,
	getFirstProviderScriptId,
	pollSandboxResult,
} from "../fixtures";
import { assertCondition, assertTaggedError } from "../test-support/assertions";

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

	it("completes with a host-function error when executeQueryEngine is not allowed", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			metadata: {},
			name: "no-host-functions",
			slug: `no-host-functions-${crypto.randomUUID()}`,
			code: `driver("main", async function() {
  return await executeQueryEngine({ source: { type: "entities", alias: "entity", schemas: ["movie"], where: null }, output: { type: "rows", fields: [], pagination: { page: 1, limit: 1 }, orderBy: [{ order: "asc", expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "name" } } }] } });
});`,
		});

		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);
		expect(result.status).toBe("completed");
		assertCondition(result.status === "completed", "Expected sandbox job to complete");

		expect(result.error).toContain("executeQueryEngine is not defined");
	});
});
