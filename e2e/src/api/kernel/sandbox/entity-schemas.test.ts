import { Effect } from "effect";

import {
	createAuthenticatedClient,
	testPluginEntitySchema,
	entitySchemasSandboxSource,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	pollSandboxResult,
} from "~/fixtures/kernel";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox entity schema reads", () => {
	it.live("reads deduplicated schemas in first-seen input order", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `get-entity-schemas-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "Get entity schemas",
				capabilities: ["getEntitySchemas"],
				source: entitySchemasSandboxSource({ slug, name: "Get entity schemas" }),
				entitySchemas: [
					testPluginEntitySchema({ slug: "first", name: "First schema" }),
					testPluginEntitySchema({ slug: "second", name: "Second schema" }),
				],
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				lane: "interactive",
				context: { slugs: ["second", "first", "second"] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "get entity schemas sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ id: "second", name: "Second schema" },
				{ id: "first", name: "First schema" },
			]);

			const { jobId: emptyJobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				lane: "interactive",
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
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `get-entity-schemas-missing-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "Get entity schemas missing",
				capabilities: ["getEntitySchemas"],
				source: entitySchemasSandboxSource({ slug, name: "Get entity schemas missing" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				lane: "interactive",
				context: { slugs: ["missing-schema"] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "missing entity schema sandbox job");
			expect(result.error).toMatchObject({ phase: "execute", message: "Entity schema not found" });
		}),
	);
});
