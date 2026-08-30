import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";
import { assert, expect, it } from "vitest";

import workflow from "./media-monitoring-sweep.sandbox";

const completeReplay = (
	resolve: (request: WorkflowReplayEnvelope["requests"][number]) => JsonValue,
) =>
	Effect.gen(function* () {
		const journal: JsonValue[] = [];
		for (;;) {
			const envelope = yield* workflow.run(
				{},
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				{ metadata: {}, sandboxScriptId: "workflow-test" },
			);
			if (envelope.state === "completed") {
				return { output: envelope.output, requests: envelope.requests };
			}
			expect(envelope.state).toBe("pending");
			if (envelope.state === "failed") {
				throw new Error(envelope.error);
			}
			const request = envelope.requests[journal.length];
			assert(request);
			journal.push(resolve(request));
		}
	});

const target = (index: number) => ({
	entitySchemaSlug: "movie",
	entityId: `entity-${index}`,
	externalId: `external-${index}`,
	providerId: `provider-${index}`,
});

type DurableRequest = WorkflowReplayEnvelope["requests"][number];
type ActivityRequest = Extract<DurableRequest, { readonly kind: "activity" }>;
type ChildRequest = Extract<DurableRequest, { readonly kind: "child" }>;

const RefreshInput = Schema.Struct({
	mode: Schema.Literal("refresh"),
	items: Schema.Array(
		Schema.Struct({
			externalId: Schema.String,
			providerId: Schema.String,
			entitySchemaSlug: Schema.String,
		}),
	),
});

// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits this Promise-returning test callback.
it("deduplicates paged targets and orchestrates bounded provider refresh batches", async () => {
	const firstPage = Array.from({ length: 100 }, (_, index) => target(index));
	const secondPage = [
		target(99),
		...Array.from({ length: 105 }, (_, index) => target(index + 100)),
	];
	const result = await Effect.runPromise(
		completeReplay((request) => {
			if (request.kind === "activity") {
				return request.name === "targets-0"
					? { items: firstPage, nextCursor: "targets-cursor" }
					: { nextCursor: null, items: secondPage };
			}
			return [];
		}),
	);

	expect(result.output).toEqual({ batchCount: 3, targetCount: 205 });
	const activities = result.requests.filter(
		(request): request is ActivityRequest => request.kind === "activity",
	);
	expect(activities.map(({ args, name }) => ({ name, input: args.input }))).toEqual([
		{ name: "targets-0", input: { limit: 100 } },
		{ name: "targets-1", input: { limit: 100, after: "targets-cursor" } },
	]);
	const children = result.requests.filter(
		(request): request is ChildRequest => request.kind === "child",
	);
	expect(children.map(({ args }) => args.workflowSlug)).toEqual([
		"kernel:provider-entity-population",
		"kernel:provider-entity-population",
		"kernel:provider-entity-population",
	]);
	expect(
		children.map(({ args }) => Schema.decodeUnknownSync(RefreshInput)(args.input).items.length),
	).toEqual([100, 100, 5]);
	const firstRefresh = Schema.decodeUnknownSync(RefreshInput)(children[0]?.args.input);
	expect(firstRefresh.mode).toBe("refresh");
	expect(firstRefresh.items[0]).toEqual({
		externalId: "external-0",
		providerId: "provider-0",
		entitySchemaSlug: "movie",
	});
});
