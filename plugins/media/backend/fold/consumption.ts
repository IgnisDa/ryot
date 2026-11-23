import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { FoldResult } from "@ryot-app/plugin-backend-sdk/folds";
import { EventId } from "@ryot-app/plugin-kit/schema";

import {
	allocateConsumptionObservation,
	type ConsumptionAllocationState,
	ConsumptionObservation,
	type ConsumptionRunCursor,
	consumptionRunForObservation,
	emptyConsumptionAllocationState,
	emptyConsumptionRunPlan,
	planConsumptionObservation,
} from "../../shared/consumption-allocation";
import {
	ConsumptionContribution,
	consumptionContribution,
	consumptionEventSlugs,
} from "../../shared/consumption-projection";
import { MediaSandboxError } from "../lib/failures";
import { compareHistory, compareText, type FoldEvent } from "./history";

export type FoldTail = {
	readonly run: ReadonlyArray<FoldEvent>;
	readonly lead: ReadonlyArray<FoldEvent>;
};

const isConsumption = (slug: string) => consumptionEventSlugs.some((value) => value === slug);

const groupOf = (event: FoldEvent) => {
	const run = event.properties["sourceRun"];
	if (typeof run === "string") {
		return `source:${run}`;
	}
	return event.eventSchemaSlug === "item-complete" ? `item:${event.id}` : "";
};

const allocationFailure = (cause: unknown) =>
	new MediaSandboxError({ message: cause instanceof Error ? cause.message : String(cause) });

/**
 * Allocates each consumption event's contribution, title by title, in source-run groups and then
 * history order. Retained boundaries close their progress runs, and automatic completions join them.
 * A run holding a `context` event is only partly known, so it contributes nothing. `tails` holds each
 * entity's latest run of unsourced events unless a completion ends it, with the earlier events that
 * occurred at the instant it starts.
 */
export const consumptionContributions = Effect.fn("consumptionContributions")(function* (input: {
	readonly context?: ReadonlySet<string>;
	readonly boundaries: ReadonlySet<string>;
	readonly history: ReadonlyArray<FoldEvent>;
	readonly automatic: ReadonlyMap<
		string,
		{ readonly sourceEventId: string; readonly rule: "progress" | "coverage" }
	>;
}) {
	const byEntity = new Map<string, Array<{ group: string; event: FoldEvent }>>();
	for (const event of input.history) {
		if (!isConsumption(event.eventSchemaSlug)) {
			continue;
		}
		const rows = byEntity.get(event.entityId) ?? [];
		rows.push({ event, group: groupOf(event) });
		byEntity.set(event.entityId, rows);
	}
	const contributions: Array<FoldResult["events"][number]> = [];
	const tails = new Map<string, FoldTail>();
	for (const [entityId, rows] of byEntity) {
		rows.sort(
			(left, right) =>
				compareText(left.group, right.group) || compareHistory(left.event, right.event),
		);
		const runs: Array<{
			group: string;
			runKey: string;
			events: Array<FoldEvent>;
			observations: Array<ConsumptionObservation>;
		}> = [];
		let cursor: ConsumptionRunCursor = { unit: null, runKey: null, closedBy: null };
		for (const { event, group } of rows) {
			const automatic = input.automatic.get(event.id);
			const observation = yield* Schema.decodeUnknownEffect(ConsumptionObservation)({
				id: event.id,
				entityId: event.entityId,
				occurredAt: event.occurredAt,
				properties: event.properties,
				eventSchemaSlug: event.eventSchemaSlug,
				entitySchemaSlug: event.entitySchemaSlug,
				closesRun: input.boundaries.has(event.id),
				...(automatic === undefined ? {} : { automatic }),
			});
			const next = yield* Effect.try({
				catch: allocationFailure,
				try: () => consumptionRunForObservation(cursor, observation),
			});
			cursor = next.cursor;
			const last = runs.at(-1);
			if (last?.runKey === next.runKey) {
				last.observations.push(observation);
				last.events.push(event);
			} else {
				runs.push({ group, events: [event], runKey: next.runKey, observations: [observation] });
			}
		}
		const unsourced = runs.filter(({ group }) => group === "");
		const tail = unsourced.at(-1);
		const start = tail?.events[0];
		if (
			tail !== undefined &&
			start !== undefined &&
			tail.events.at(-1)?.eventSchemaSlug !== "complete"
		) {
			tails.set(entityId, {
				run: tail.events,
				lead: unsourced
					.slice(0, -1)
					.flatMap(({ events }) => events)
					.filter(({ occurredAt }) => occurredAt === start.occurredAt),
			});
		}
		for (const run of runs) {
			if (run.events.some(({ id }) => input.context?.has(id) === true)) {
				continue;
			}
			const plan = run.observations.reduce(planConsumptionObservation, emptyConsumptionRunPlan());
			let state: ConsumptionAllocationState = emptyConsumptionAllocationState();
			for (const observation of run.observations) {
				const next = yield* Effect.try({
					catch: allocationFailure,
					try: () => allocateConsumptionObservation(plan, state, observation),
				});
				state = next.state;
				contributions.push({
					eventId: EventId.make(observation.id),
					properties: {
						contribution: yield* Schema.encodeEffect(Schema.toCodecJson(ConsumptionContribution))(
							consumptionContribution(next.allocation),
						),
					},
				});
			}
		}
	}
	return { tails, contributions };
});
