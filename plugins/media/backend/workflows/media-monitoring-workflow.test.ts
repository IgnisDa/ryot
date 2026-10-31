import { assert, expect, it } from "@effect/vitest";
import { driveWorkflowReplay } from "@ryot-app/plugin-backend-sdk/testing";
import type { WorkflowReplayEnvelope } from "@ryot-app/plugin-backend-sdk/workflow";
import { Effect, Schema } from "effect";

import workflow from "./media-monitoring-sweep.sandbox";

const target = (index: number) => ({
	entitySchemaSlug: "movie",
	entityId: `entity-${index}`,
	externalId: `external-${index}`,
	providerId: `provider-${index}`,
});

type DurableRequest = WorkflowReplayEnvelope["requests"][number];
type ChildRequest = Extract<DurableRequest, { readonly kind: "child" }>;
type ActivityRequest = Extract<DurableRequest, { readonly kind: "activity" }>;

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

it.live("refreshes each live target page before fetching the next and counts bounded batches", () =>
	Effect.gen(function* () {
		const pages = [
			Array.from({ length: 100 }, (_, index) => target(index)),
			Array.from({ length: 100 }, (_, index) => target(index + 100)),
			Array.from({ length: 5 }, (_, index) => target(index + 200)),
		];
		const resolved: string[] = [];
		const result = yield* driveWorkflowReplay(workflow.run, {}, (request) => {
			if (request.kind === "activity") {
				resolved.push(request.name);
				const pageIndex = Number(request.name.slice("targets-".length));
				return {
					items: pages[pageIndex] ?? [],
					nextCursor: pageIndex < pages.length - 1 ? `cursor-${pageIndex}` : null,
				};
			}
			resolved.push(request.name);
			return [];
		});
		assert(result.state === "completed");
		expect(result.output).toEqual({ batchCount: 3, targetCount: 205 });
		const activities = result.requests.filter(
			(request): request is ActivityRequest => request.kind === "activity",
		);
		expect(activities.map(({ args, name }) => ({ name, input: args.input }))).toEqual([
			{ name: "targets-0", input: { limit: 100 } },
			{ name: "targets-1", input: { limit: 100, after: "cursor-0" } },
			{ name: "targets-2", input: { limit: 100, after: "cursor-1" } },
		]);
		const children = result.requests.filter(
			(request): request is ChildRequest => request.kind === "child",
		);
		expect(children.map(({ name }) => name)).toEqual(["refresh-0", "refresh-1", "refresh-2"]);
		expect(children.map(({ args }) => args.workflowSlug)).toEqual([
			"kernel:provider-entity-population",
			"kernel:provider-entity-population",
			"kernel:provider-entity-population",
		]);
		const refreshInputs = yield* Effect.forEach(children, ({ args }) =>
			Schema.decodeUnknownEffect(RefreshInput)(args.input),
		);
		expect(refreshInputs.map(({ items }) => items.length)).toEqual([100, 100, 5]);
		expect(result.requests.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
			"activity:targets-0",
			"child:refresh-0",
			"activity:targets-1",
			"child:refresh-1",
			"activity:targets-2",
			"child:refresh-2",
		]);
		expect(resolved).toEqual([
			"targets-0",
			"refresh-0",
			"targets-1",
			"refresh-1",
			"targets-2",
			"refresh-2",
		]);
		const firstRefresh = refreshInputs[0];
		assert(firstRefresh);
		expect(firstRefresh.mode).toBe("refresh");
		expect(firstRefresh.items[0]).toEqual({
			externalId: "external-0",
			providerId: "provider-0",
			entitySchemaSlug: "movie",
		});
	}),
);

it.live("ends on an empty page and does not request an empty continuation", () =>
	Effect.gen(function* () {
		const empty = yield* driveWorkflowReplay(workflow.run, {}, () => ({
			items: [],
			nextCursor: null,
		}));
		assert(empty.state === "completed");
		expect(empty.output).toEqual({ batchCount: 0, targetCount: 0 });
		expect(empty.requests.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
			"activity:targets-0",
		]);

		const invalid = yield* driveWorkflowReplay(workflow.run, {}, (request) =>
			request.kind === "activity" ? { nextCursor: "", items: [target(0)] } : [],
		);
		assert(invalid.state === "completed");
		expect(invalid.output).toEqual({ batchCount: 1, targetCount: 1 });
		expect(invalid.requests.map(({ kind, name }) => `${kind}:${name}`)).toEqual([
			"activity:targets-0",
			"child:refresh-0",
		]);
	}),
);
