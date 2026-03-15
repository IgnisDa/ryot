import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEventSchema,
	createPluginSchema,
	eventSchemasSandboxSource,
	enqueueSandboxScript,
	installSandboxScriptScoped,
	pollSandboxResult,
} from "~/fixtures";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox event schema reads", () => {
	it.live("reads deduplicated schemas in first-seen input order", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const first = yield* createPluginSchema(client, { name: "First schema" });
			const second = yield* createPluginSchema(client, { name: "Second schema" });
			const firstEvent = yield* createEventSchema(client, {
				name: "First event",
				entitySchemaSlug: first.schemaId,
				slug: `first-event-${crypto.randomUUID()}`,
			});
			const secondEvent = yield* createEventSchema(client, {
				name: "Second event",
				entitySchemaSlug: second.schemaId,
				slug: `second-event-${crypto.randomUUID()}`,
			});
			const slug = `list-event-schemas-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "List event schemas",
				capabilities: ["listEventSchemas"],
				source: eventSchemasSandboxSource({ name: "List event schemas", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { slugs: [second.schemaId, first.schemaId, second.schemaId] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "list event schemas sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ id: secondEvent.id, entitySchemaSlug: second.schemaId },
				{ id: firstEvent.id, entitySchemaSlug: first.schemaId },
			]);

			const { jobId: emptyJobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { slugs: [] },
			});
			const emptyResult = yield* pollSandboxResult(userId, emptyJobId);
			assertCompleted(emptyResult, "empty list event schemas sandbox job");
			expect(emptyResult.error).toBeNull();
			expect(emptyResult.value).toEqual([]);
		}),
	);

	it.live("fails entire batch when one schema does not exist", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const existing = yield* createPluginSchema(client, { name: "Existing schema" });
			const slug = `list-event-schemas-missing-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "List event schemas missing",
				capabilities: ["listEventSchemas"],
				source: eventSchemasSandboxSource({ slug, name: "List event schemas missing" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				context: { slugs: [existing.schemaId, "missing-schema"] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "missing event schema sandbox job");
			expect(result.error).toMatchObject({ phase: "execute", message: "Entity schema not found" });
		}),
	);
});
