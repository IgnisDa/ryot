import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	EventStreamStepInput,
	EventStreamStepOutput,
} from "@ryot-app/plugin-backend-sdk/event-streams";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
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
import { consumptionPageRecipe, consumptionPageSize } from "./contracts/consumption-recipes";
import { MediaSandboxError } from "./lib/failures";

const pagesPerStep = 8;
const updatesPerStep = 100;

export const manifest = defineManifest({
	kind: "script",
	name: "Compute media consumption",
	slug: "script.media-consumption-step",
});

export default defineScript({
	manifest,
	input: EventStreamStepInput,
	output: EventStreamStepOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			let checkpoint =
				input.checkpoint === null
					? initialConsumptionCheckpoint()
					: yield* Schema.decodeUnknownEffect(ConsumptionCheckpoint)(input.checkpoint);
			const updates: (typeof EventStreamStepOutput.Type)["updates"][number][] = [];
			for (
				let page = 0;
				page < pagesPerStep && updates.length + consumptionPageSize <= updatesPerStep;
				page += 1
			) {
				const rows = yield* executeRyotqlRecipe(
					host.executeRyotql,
					consumptionPageRecipe({ after: checkpoint.after, entityId: input.entityId }),
				);
				let boundary = false;
				for (const row of rows.items) {
					const { automatic, ...source } = row;
					const observation: ConsumptionObservation = {
						...source,
						closesRun:
							row.boundary?.frozen === true &&
							(row.boundary.status === "active" || row.boundary.status === "suppressed"),
						...(automatic?.sourceEventId === undefined
							? {}
							: { automatic: { rule: automatic.rule, sourceEventId: automatic.sourceEventId } }),
					};
					const position = {
						id: row.id,
						group: row.group,
						orderKey: row.orderKey,
						occurredAt: row.occurredAt,
						orderCreatedAt: row.orderCreatedAt,
					};
					if (checkpoint.phase === "plan") {
						const run = consumptionRunForObservation(checkpoint.cursor, observation);
						if (checkpoint.runKey !== null && run.runKey !== checkpoint.runKey) {
							boundary = true;
							break;
						}
						checkpoint = {
							...checkpoint,
							after: position,
							cursor: run.cursor,
							runKey: run.runKey,
							plan: planConsumptionObservation(checkpoint.plan, observation),
						};
					} else {
						const next = allocateConsumptionObservation(
							checkpoint.plan,
							checkpoint.allocation,
							observation,
						);
						checkpoint = { ...checkpoint, after: position, allocation: next.state };
						if (row.eventSchemaSlug === input.eventSchemaSlug) {
							const contribution = yield* Schema.encodeEffect(
								Schema.toCodecJson(ConsumptionContribution),
							)(consumptionContribution(next.allocation));
							updates.push({ properties: { contribution }, eventId: EventId.make(row.id) });
						}
						if (next.state.index === checkpoint.plan.count) {
							boundary = true;
							break;
						}
					}
				}
				if (checkpoint.phase === "plan" && (boundary || !rows.pageInfo.hasMore)) {
					if (checkpoint.plan.count === 0) {
						return { updates, done: true, checkpoint: null };
					}
					checkpoint = { ...checkpoint, phase: "replay", after: checkpoint.start };
				} else if (checkpoint.phase === "replay" && boundary) {
					checkpoint = initialConsumptionCheckpoint(checkpoint.after, checkpoint.cursor);
				} else if (checkpoint.phase === "replay" && !rows.pageInfo.hasMore) {
					return yield* new MediaSandboxError({
						message: "Consumption replay ended before its planned run",
					});
				}
			}
			return {
				updates,
				done: false,
				checkpoint: yield* Schema.encodeEffect(Schema.toCodecJson(ConsumptionCheckpoint))(
					checkpoint,
				),
			};
		}),
});
