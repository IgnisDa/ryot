import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	EVENT_STREAM_BATCH_LIMITS,
	EventStreamBatchInput,
	EventStreamBatchOutput,
} from "@ryot-app/plugin-backend-sdk/event-streams";
import { executeRyotqlRecipe, type Recipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { EventId } from "@ryot-app/plugin-kit/schema";

import {
	allocateConsumptionObservation,
	type ConsumptionObservation,
	consumptionRunForObservation,
	planConsumptionObservation,
} from "../shared/consumption-allocation";
import {
	ConsumptionCheckpoint,
	ConsumptionContribution,
	consumptionContribution,
	initialConsumptionCheckpoint,
} from "../shared/consumption-projection";
import { consumptionBatchRecipe } from "./contracts/consumption-recipes";
import { MediaSandboxError } from "./lib/failures";

const roundsPerBatch = 20;
const updatesPerStream = 100;

type Row = Recipe.Success<typeof consumptionBatchRecipe>["items"][number];
type StreamOutput = (typeof EventStreamBatchOutput.Type)["streams"][number];
type Stream = {
	checkpoint: ConsumptionCheckpoint;
	readonly entityId: StreamOutput["entityId"];
	readonly updates: Array<StreamOutput["updates"][number]>;
	result: null | { readonly done: boolean; readonly checkpoint: null | ConsumptionCheckpoint };
};

const advance = (
	checkpoint: ConsumptionCheckpoint,
	patch: Partial<ConsumptionCheckpoint>,
): ConsumptionCheckpoint => ({ ...checkpoint, ...patch });

const observationOf = (row: Row): ConsumptionObservation => {
	const { automatic, ...source } = row;
	return {
		...source,
		closesRun:
			row.boundary?.frozen === true &&
			(row.boundary.status === "active" || row.boundary.status === "suppressed"),
		...(automatic?.sourceEventId === undefined
			? {}
			: { automatic: { rule: automatic.rule, sourceEventId: automatic.sourceEventId } }),
	};
};

const positionOf = (row: Row) => ({
	id: row.id,
	group: row.group,
	orderKey: row.orderKey,
	occurredAt: row.occurredAt,
	orderCreatedAt: row.orderCreatedAt,
});

const advanceStream = (
	stream: Stream,
	rows: ReadonlyArray<Row>,
	ended: boolean,
	eventSchemaSlug: string,
	budget: { remaining: number },
) =>
	Effect.gen(function* () {
		let checkpoint = stream.checkpoint;
		let planStart = checkpoint.phase === "plan" && checkpoint.runKey === null ? 0 : null;
		let index = 0;
		const replay = () => {
			checkpoint = advance(checkpoint, { phase: "replay", after: checkpoint.start });
			if (planStart === null) {
				return false;
			}
			index = planStart;
			planStart = null;
			return true;
		};
		for (;;) {
			const row = rows[index];
			if (row === undefined) {
				if (!ended) {
					break;
				}
				if (checkpoint.phase === "replay") {
					return yield* new MediaSandboxError({
						message: "Consumption replay ended before its planned run",
					});
				}
				if (checkpoint.plan.count === 0) {
					stream.result = { done: true, checkpoint: null };
					return undefined;
				}
				if (replay()) {
					continue;
				}
				break;
			}
			const observation = observationOf(row);
			if (checkpoint.phase === "plan") {
				const run = consumptionRunForObservation(checkpoint.cursor, observation);
				if (checkpoint.runKey !== null && run.runKey !== checkpoint.runKey) {
					if (replay()) {
						continue;
					}
					break;
				}
				checkpoint = advance(checkpoint, {
					cursor: run.cursor,
					runKey: run.runKey,
					after: positionOf(row),
					plan: planConsumptionObservation(checkpoint.plan, observation),
				});
				index += 1;
				continue;
			}
			if (stream.updates.length >= updatesPerStream || budget.remaining <= 0) {
				stream.checkpoint = checkpoint;
				stream.result = { checkpoint, done: false };
				return undefined;
			}
			const next = allocateConsumptionObservation(
				checkpoint.plan,
				checkpoint.allocation,
				observation,
			);
			checkpoint = advance(checkpoint, { after: positionOf(row), allocation: next.state });
			if (row.eventSchemaSlug === eventSchemaSlug) {
				const contribution = yield* Schema.encodeEffect(
					Schema.toCodecJson(ConsumptionContribution),
				)(consumptionContribution(next.allocation));
				stream.updates.push({ properties: { contribution }, eventId: EventId.make(row.id) });
				budget.remaining -= 1;
			}
			index += 1;
			if (next.state.index === checkpoint.plan.count) {
				checkpoint = initialConsumptionCheckpoint(checkpoint.after, checkpoint.cursor);
				planStart = index;
			}
		}
		stream.checkpoint = checkpoint;
		return undefined;
	});

export const manifest = defineManifest({
	kind: "script",
	name: "Compute media consumption",
	slug: "script.media-consumption-step",
});

export default defineScript({
	manifest,
	input: EventStreamBatchInput,
	output: EventStreamBatchOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const streams: Array<Stream> = yield* Effect.forEach(input.streams, (stream) =>
				Effect.gen(function* () {
					const checkpoint =
						stream.checkpoint === null
							? initialConsumptionCheckpoint()
							: yield* Schema.decodeUnknownEffect(ConsumptionCheckpoint)(stream.checkpoint);
					return { checkpoint, updates: [], result: null, entityId: stream.entityId };
				}),
			);
			const budget = { remaining: EVENT_STREAM_BATCH_LIMITS.updates };
			for (let round = 0; round < roundsPerBatch && budget.remaining > 0; round += 1) {
				const active = streams.filter((stream) => stream.result === null);
				if (active.length === 0) {
					break;
				}
				const rows = yield* executeRyotqlRecipe(
					host.executeRyotql,
					consumptionBatchRecipe({
						streams: active.map(({ entityId, checkpoint }) => ({
							entityId,
							after: checkpoint.after,
						})),
					}),
				);
				const partial = rows.pageInfo.hasMore ? rows.items.at(-1)?.entityId : undefined;
				for (const stream of active) {
					const own = rows.items.filter((row) => row.entityId === stream.entityId);
					if (rows.pageInfo.hasMore && own.length === 0) {
						continue;
					}
					yield* advanceStream(
						stream,
						own,
						partial !== stream.entityId,
						input.eventSchemaSlug,
						budget,
					);
				}
			}
			return {
				streams: yield* Effect.forEach(streams, (stream) =>
					Effect.gen(function* () {
						const result = stream.result ?? { done: false, checkpoint: stream.checkpoint };
						return {
							done: result.done,
							updates: stream.updates,
							entityId: stream.entityId,
							checkpoint:
								result.checkpoint === null
									? null
									: yield* Schema.encodeEffect(Schema.toCodecJson(ConsumptionCheckpoint))(
											result.checkpoint,
										),
						};
					}),
				),
			};
		}),
});
