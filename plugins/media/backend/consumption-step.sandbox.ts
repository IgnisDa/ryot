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
import { consumptionPageRecipe } from "./contracts/consumption-recipes";
import { MediaSandboxError } from "./lib/failures";

export const manifest = defineManifest({
	kind: "script",
	name: "Repair media consumption",
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
			if (checkpoint.phase === "done") {
				checkpoint = initialConsumptionCheckpoint();
			}
			const updates: (typeof EventStreamStepOutput.Type)["updates"][number][] = [];
			for (let step = 0; step < 8 && updates.length <= 50; step += 1) {
				const result = yield* executeRyotqlRecipe(
					host.executeRyotql,
					consumptionPageRecipe({
						after: checkpoint.after,
						entityId: input.entityId,
						dependenciesAfter: checkpoint.dependenciesAfter ?? undefined,
					}),
				);
				if (
					result.context?.dependenciesMissing !== false ||
					result.correction?.properties.phase !== "done" ||
					result.correction.properties.sourceRevision !== result.revision
				) {
					return { done: false, updates: [], checkpoint: null, waitingForInputs: true };
				}
				if (!checkpoint.dependenciesReady) {
					checkpoint = {
						...checkpoint,
						dependenciesBlocked:
							checkpoint.dependenciesBlocked ||
							result.dependencies.items.some(
								(dependency) =>
									dependency.correction?.phase !== "done" ||
									dependency.correction.sourceRevision !== dependency.revision,
							),
					};
					if (result.dependencies.pageInfo.hasMore) {
						if (result.dependencies.pageInfo.nextCursor === null) {
							return yield* new MediaSandboxError({
								message: "Consumption dependency page has no cursor",
							});
						}
						checkpoint = {
							...checkpoint,
							dependenciesAfter: result.dependencies.pageInfo.nextCursor,
						};
						continue;
					}
					if (checkpoint.dependenciesBlocked) {
						return { done: false, updates: [], checkpoint: null, waitingForInputs: true };
					}
					checkpoint = { ...checkpoint, dependenciesReady: true };
				}
				let boundary = false;
				for (const row of result.rows.items) {
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
				if (checkpoint.phase === "plan" && (boundary || !result.rows.pageInfo.hasMore)) {
					if (checkpoint.plan.count === 0) {
						checkpoint = { ...checkpoint, phase: "done" };
						break;
					}
					checkpoint = { ...checkpoint, phase: "replay", after: checkpoint.start };
				} else if (checkpoint.phase === "replay" && boundary) {
					checkpoint = {
						...initialConsumptionCheckpoint(checkpoint.after, checkpoint.cursor),
						dependenciesReady: true,
					};
				} else if (checkpoint.phase === "replay" && !result.rows.pageInfo.hasMore) {
					return yield* new MediaSandboxError({
						message: "Consumption replay ended before its planned run",
					});
				}
			}
			const encoded = yield* Schema.encodeEffect(Schema.toCodecJson(ConsumptionCheckpoint))(
				checkpoint,
			);
			const serialized = yield* Schema.encodeEffect(Schema.fromJsonString(ConsumptionCheckpoint))(
				checkpoint,
			);
			if (new TextEncoder().encode(serialized).byteLength > 16384) {
				return yield* new MediaSandboxError({ message: "Consumption checkpoint exceeds 16 KiB" });
			}
			return yield* Schema.decodeEffect(EventStreamStepOutput)({
				updates,
				checkpoint: encoded,
				done: checkpoint.phase === "done",
			});
		}),
});
