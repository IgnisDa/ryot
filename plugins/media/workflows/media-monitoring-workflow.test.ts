import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";
import { assert, expect, it } from "vitest";

import workflow from "../scripts/workflows/media-monitoring-sweep.sandbox";

const completeReplay = async (
	resolve: (request: WorkflowReplayEnvelope["requests"][number]) => JsonValue,
) => {
	const journal: JsonValue[] = [];
	const run = (): Promise<{ output: JsonValue; requests: WorkflowReplayEnvelope["requests"] }> =>
		Effect.runPromise(
			workflow.run(
				{},
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				{ metadata: {}, sandboxScriptId: "workflow-test" },
			),
		).then((envelope) => {
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
			return run();
		});
	return run();
};

const target = (index: number) => ({
	entityId: `entity-${index}`,
	externalId: `external-${index}`,
	providerId: `provider-${index}`,
	entitySchemaSlug: "movie",
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

it("deduplicates paged targets and orchestrates bounded provider refresh batches", async () => {
	const firstPage = Array.from({ length: 100 }, (_, index) => target(index));
	const secondPage = [
		target(99),
		...Array.from({ length: 105 }, (_, index) => target(index + 100)),
	];
	const result = await completeReplay((request) => {
		if (request.kind === "activity") {
			return request.name === "targets-1"
				? { hasMore: true, items: firstPage }
				: { hasMore: false, items: secondPage };
		}
		return [];
	});

	expect(result.output).toEqual({ batchCount: 3, targetCount: 205 });
	const activities = result.requests.filter(
		(request): request is ActivityRequest => request.kind === "activity",
	);
	expect(activities.map(({ args, name }) => ({ name, input: args.input }))).toEqual([
		{ name: "targets-1", input: { page: 1, limit: 100 } },
		{ name: "targets-2", input: { page: 2, limit: 100 } },
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
