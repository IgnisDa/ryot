import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createPluginSchema,
	entitySchemasSandboxSource,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	pollSandboxResult,
} from "~/fixtures";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox entity schema reads", () => {
	it.live("reads deduplicated schemas in first-seen input order", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const first = yield* createPluginSchema(client, { name: "First schema" });
			const second = yield* createPluginSchema(client, { name: "Second schema" });
			const slug = `get-entity-schemas-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Get entity schemas",
				capabilities: ["getEntitySchemas"],
				source: entitySchemasSandboxSource({ name: "Get entity schemas", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { slugs: [second.slug, first.slug, second.slug] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "get entity schemas sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ id: second.schemaId, name: "Second schema" },
				{ id: first.schemaId, name: "First schema" },
			]);

			const { jobId: emptyJobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { slugs: [] },
			});
			const emptyResult = yield* pollSandboxResult(userId, emptyJobId);
			assertCompleted(emptyResult, "empty get entity schemas sandbox job");
			expect(emptyResult.error).toBeNull();
			expect(emptyResult.value).toEqual([]);
		}),
	);

	it.live("fails entire batch when one schema does not exist", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `get-entity-schemas-missing-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Get entity schemas missing",
				capabilities: ["getEntitySchemas"],
				source: entitySchemasSandboxSource({ name: "Get entity schemas missing", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { slugs: ["missing-schema"] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "missing entity schema sandbox job");
			expect(result.error).toMatchObject({ phase: "execute", message: "Entity schema not found" });
		}),
	);
});
