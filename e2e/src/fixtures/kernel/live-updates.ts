import {
	type EntityUpdatedFrame,
	LIVE_UPDATES_CONNECTED_EVENT,
	LiveUpdateFrame,
	type PopulateEntitiesBody,
} from "@ryot-app/contract/modules/live-updates/messages";
import { Deferred, Duration, Effect, Fiber, Schema, Stream } from "effect";

import type { ContractSession } from "./contract-client";
import { getEntity } from "./entities";
import { pollUntil } from "./polling";

export const GRACE_WINDOW_MS = 3000;

export const waitOutGraceWindow = Effect.sleep(Duration.millis(GRACE_WINDOW_MS));

type Reason = EntityUpdatedFrame["reason"];
type Waiter = { readonly check: () => void };
type WaitOptions = { readonly timeoutMs?: number };

const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(LiveUpdateFrame));

const isMatch = (frame: EntityUpdatedFrame, entityId: string, reason?: Reason) =>
	frame.entityId === entityId && (reason === undefined || frame.reason === reason);

export const populateEntities = (
	auth: { readonly client: ContractSession },
	entityIds: ReadonlyArray<string>,
	priority: PopulateEntitiesBody["priority"] = "background",
) =>
	auth.client.call((contract) =>
		contract.entities.populate({ payload: { priority, entityIds: [...entityIds] } }),
	);

export const openLiveUpdatesScoped = (auth: { readonly client: ContractSession }) =>
	Effect.gen(function* () {
		const response = yield* auth.client.call((contract) =>
			contract["live-updates"].events({ responseMode: "response-only" }),
		);
		if (response.status !== 200) {
			throw new Error(`Live updates stream returned HTTP ${response.status}`);
		}
		if (!response.headers["content-type"]?.startsWith("text/event-stream")) {
			throw new Error("Live updates stream has an invalid content type");
		}

		const connected = yield* Deferred.make<void>();
		const ended = yield* Deferred.make<void>();
		const frames: EntityUpdatedFrame[] = [];
		const waiters = new Set<Waiter>();
		const decoder = new TextDecoder();
		let buffer = "";

		const consumeBlock = (block: string) => {
			const lines = block.split(/\r?\n/).filter((line) => !line.startsWith(":"));
			if (lines.includes(`event: ${LIVE_UPDATES_CONNECTED_EVENT}`)) {
				Deferred.doneUnsafe(connected, Effect.void);
				return;
			}
			const data = lines.find((line) => line.startsWith("data:"))?.slice(5);
			if (data === undefined) {
				return;
			}
			const frame = decodeFrame(data);
			if (frame._tag === "Some" && frame.value.type === "entity-updated") {
				frames.push(frame.value);
				for (const waiter of waiters) {
					waiter.check();
				}
			}
		};

		const fiber = yield* Stream.runForEach(response.stream, (chunk) =>
			Effect.sync(() => {
				buffer += decoder.decode(chunk, { stream: true });
				const blocks = buffer.split(/\r?\n\r?\n/);
				buffer = blocks.pop() ?? "";
				for (const block of blocks) {
					consumeBlock(block);
				}
			}),
		).pipe(Effect.ignore, Effect.ensuring(Deferred.succeed(ended, undefined)), Effect.forkScoped);

		yield* Deferred.await(connected).pipe(
			Effect.timeoutOrElse({
				duration: Duration.seconds(10),
				orElse: () => Effect.die(new Error("Live updates stream did not connect in time")),
			}),
		);

		const waitForEntityUpdated = (entityId: string, reason?: Reason, options: WaitOptions = {}) =>
			Effect.callback<EntityUpdatedFrame>((resume) => {
				const waiter: Waiter = {
					check: () => {
						const found = frames.find((frame) => isMatch(frame, entityId, reason));
						if (found !== undefined) {
							waiters.delete(waiter);
							resume(Effect.succeed(found));
						}
					},
				};
				waiters.add(waiter);
				waiter.check();
				return Effect.sync(() => {
					waiters.delete(waiter);
				});
			}).pipe(
				Effect.timeoutOrElse({
					duration: options.timeoutMs ?? 90_000,
					orElse: () =>
						Effect.die(new Error(`Timed out waiting for entity-updated for '${entityId}'`)),
				}),
			);

		return {
			waitForEntityUpdated,
			close: () => Fiber.interrupt(fiber),
			getEntityUpdatedFrames: () => frames.slice(),
			populate: (entityIds: ReadonlyArray<string>, priority?: PopulateEntitiesBody["priority"]) =>
				populateEntities(auth, entityIds, priority),
			waitForEnd: (options: WaitOptions = {}) =>
				Deferred.await(ended).pipe(
					Effect.timeoutOrElse({
						duration: options.timeoutMs ?? 10_000,
						orElse: () =>
							Effect.die(new Error("Timed out waiting for the live updates stream end")),
					}),
				),
			expectNoEntityUpdated: (
				entityId: string,
				{ reason, windowMs }: { readonly reason?: Reason; readonly windowMs: number },
			) =>
				Effect.sleep(Duration.millis(windowMs)).pipe(
					Effect.flatMap(() =>
						frames.some((frame) => isMatch(frame, entityId, reason))
							? Effect.die(new Error(`Unexpected entity-updated for '${entityId}'`))
							: Effect.void,
					),
				),
		};
	});

export const populateRelatedInteractively = (
	auth: { readonly client: ContractSession },
	entityId: string,
) =>
	Effect.gen(function* () {
		yield* populateEntities(auth, [entityId], "interactive");
		return yield* pollUntil(
			`entity '${entityId}' related level populated`,
			getEntity(auth.client, entityId).pipe(
				Effect.map((entity) =>
					entity.relatedPopulationStatus.availability === "complete" ? entity : null,
				),
			),
		);
	});
