import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createPluginSchema,
	entitiesSandboxSource,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	pollSandboxResult,
} from "~/fixtures";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox entity reads", () => {
	it.live("reads multiple visible entities through one host call", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createPluginSchema(client);
			const first = yield* createEntity(client, {
				properties: {},
				name: "First entity",
				entitySchemaSlug: schemaId,
			});
			const second = yield* createEntity(client, {
				properties: {},
				name: "Second entity",
				entitySchemaSlug: schemaId,
			});
			const slug = `get-entities-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Get entities",
				capabilities: ["getEntities"],
				source: entitiesSandboxSource({ name: "Get entities", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { ids: [first.id, second.id] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			expect(result.status).toBe("completed");
			assertCompleted(result, "get entities sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ id: first.id, name: "First entity" },
				{ id: second.id, name: "Second entity" },
			]);

			const { jobId: emptyJobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { ids: [] },
			});
			const emptyResult = yield* pollSandboxResult(userId, emptyJobId);
			assertCompleted(emptyResult, "empty get entities sandbox job");
			expect(emptyResult.error).toBeNull();
			expect(emptyResult.value).toEqual([]);
		}),
	);

	it.live("fails entire batch when one entity is not visible", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { schemaId } = yield* createPluginSchema(client);
			const entity = yield* createEntity(client, {
				properties: {},
				name: "Visible entity",
				entitySchemaSlug: schemaId,
			});
			const slug = `get-entities-missing-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Get entities missing",
				capabilities: ["getEntities"],
				source: entitiesSandboxSource({ name: "Get entities missing", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { ids: [entity.id, "missing-entity"] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "get entities missing sandbox job");
			expect(result.error).toMatchObject({ phase: "execute", message: "Entity not found" });
		}),
	);
});
