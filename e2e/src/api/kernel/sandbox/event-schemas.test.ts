import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	eventSchemasSandboxSource,
	installSandboxScriptScoped,
	pollSandboxResult,
	testPluginEntitySchema,
} from "~/fixtures/kernel";
import { assertCompleted } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const eventSchema = (name: string) => ({ name, slug: "event", propertiesSchema: { fields: {} } });

describe("sandbox event schema reads", () => {
	it.live("reads deduplicated schemas in first-seen input order", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const slug = `list-event-schemas-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "List event schemas",
				capabilities: ["listEventSchemas"],
				source: eventSchemasSandboxSource({ slug, name: "List event schemas" }),
				entitySchemas: [
					{
						...testPluginEntitySchema({ slug: "first" }),
						eventSchemas: [eventSchema("First event")],
					},
					{
						...testPluginEntitySchema({ slug: "second" }),
						eventSchemas: [eventSchema("Second event")],
					},
				],
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				lane: "interactive",
				context: { slugs: ["second", "first", "second"] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "list event schemas sandbox job");
			expect(result.error).toBeNull();
			expect(result.value).toMatchObject([
				{ id: "event", name: "Second event", entitySchemaSlug: "second" },
				{ id: "event", name: "First event", entitySchemaSlug: "first" },
			]);

			const { jobId: emptyJobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				lane: "interactive",
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
			const slug = `list-event-schemas-missing-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				client,
				name: "List event schemas missing",
				capabilities: ["listEventSchemas"],
				entitySchemas: [testPluginEntitySchema({ slug: "existing" })],
				source: eventSchemasSandboxSource({ slug, name: "List event schemas missing" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
				lane: "interactive",
				context: { slugs: ["existing", "missing-schema"] },
			});

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "missing event schema sandbox job");
			expect(result.error).toMatchObject({ phase: "execute", message: "Entity schema not found" });
		}),
	);
});
