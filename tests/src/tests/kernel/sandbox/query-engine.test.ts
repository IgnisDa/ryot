import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createEventTestFixture,
	createPluginSchema,
	entityRowsSandboxSource,
	enqueueSandboxScript,
	eventRowsSandboxSource,
	installSandboxScriptScoped,
	pollSandboxResult,
} from "~/fixtures";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox query-engine reads", () => {
	it.live("reads multiple visible entities through executeQueryEngine", () =>
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
			const slug = `query-entities-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Query entities",
				capabilities: ["executeQueryEngine"],
				source: entityRowsSandboxSource({ name: "Query entities", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { ids: [first.id, second.id], entitySchemaSlug: schemaId },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			expect(result.status).toBe("completed");
			assertCompleted(result, "query entities sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ id: first.id, name: "First entity" },
				{ id: second.id, name: "Second entity" },
			]);

			const { jobId: emptyJobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { ids: [], entitySchemaSlug: schemaId },
			});
			const emptyResult = yield* pollSandboxResult(userId, emptyJobId);
			assertCompleted(emptyResult, "empty query entities sandbox job");
			expect(emptyResult.error).toBeNull();
			expect(emptyResult.value).toEqual([]);
		}),
	);

	it.live("reads filtered events through executeQueryEngine", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const { entityId, entitySchemaSlug, eventSchemaSlug } = yield* createEventTestFixture(client);
			yield* client.call((c) =>
				c.events.create({
					payload: [{ entityId, eventSchemaSlug, properties: { rating: 5 } }],
				}),
			);
			const slug = `query-events-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "Query events",
				capabilities: ["executeQueryEngine"],
				source: eventRowsSandboxSource({ name: "Query events", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { entityId, entitySchemaSlug, eventSchemaSlug },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "query events sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ entityId, eventSchemaSlug, properties: { rating: 5 } },
			]);
		}),
	);
});
