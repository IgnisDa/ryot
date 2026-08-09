import type { EntityInterestEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import { Context, Effect, Fiber, FiberSet, Layer } from "effect";

const DEFAULT_ENTITY_UPDATE_BATCH_SIZE = 25;
const DEFAULT_ENTITY_UPDATE_BATCH_WINDOW_MS = 250;

export type EntityUpdateBatchHandler = (
	updates: readonly EntityInterestEntityUpdatedMessage[],
) => Effect.Effect<void, unknown>;

type EntityUpdateBatcherOptions = {
	readonly windowMs?: number;
	readonly onDrain?: () => void;
	readonly maxBatchSize?: number;
	readonly onBatch: EntityUpdateBatchHandler;
	readonly onError?: (error: unknown) => void;
};

type RunningFiber = {
	fiber: Fiber.Fiber<void> | undefined;
};

export class EntityUpdateBatcher extends Context.Service<
	EntityUpdateBatcher,
	{
		readonly setBlocked: (blocked: boolean) => Effect.Effect<void>;
		readonly push: (update: EntityInterestEntityUpdatedMessage) => Effect.Effect<void>;
	}
>()("ryot/kernel-client/entity-interest/EntityUpdateBatcher") {
	static readonly make = (options: EntityUpdateBatcherOptions) =>
		Effect.gen(function* () {
			let blocked = false;
			let disposed = false;
			let windowElapsed = false;
			let window: RunningFiber | undefined;
			let inFlight: RunningFiber | undefined;
			const pending = new Map<string, EntityInterestEntityUpdatedMessage>();
			const windowMs = options.windowMs ?? DEFAULT_ENTITY_UPDATE_BATCH_WINDOW_MS;
			const maxBatchSize = options.maxBatchSize ?? DEFAULT_ENTITY_UPDATE_BATCH_SIZE;
			const runFork = yield* FiberSet.makeRuntime<never, void, never>();

			const reportBatchError = (error: unknown) =>
				Effect.sync(() => {
					try {
						(options.onError ?? defaultReportBatchError)(error);
					} catch (reportError) {
						defaultReportBatchError(reportError);
					}
				});

			let flush: Effect.Effect<void>;
			const startWindow = () => {
				if (window || windowElapsed || blocked || disposed || pending.size === 0) {
					return;
				}
				const running: RunningFiber = { fiber: undefined };
				window = running;
				const fiber = runFork(
					Effect.gen(function* () {
						yield* Effect.sleep(windowMs);
						if (window !== running || disposed) {
							return;
						}
						window = undefined;
						windowElapsed = true;
						yield* flush;
					}),
				);
				if (window === running) {
					running.fiber = fiber;
				}
			};

			flush = Effect.gen(function* () {
				if (disposed || blocked || inFlight || pending.size === 0) {
					return;
				}
				const runningWindow = window;
				window = undefined;
				windowElapsed = false;
				if (runningWindow?.fiber) {
					yield* Fiber.interrupt(runningWindow.fiber);
				}
				const updates: EntityInterestEntityUpdatedMessage[] = [];
				for (const [entityId, update] of pending) {
					updates.push(update);
					pending.delete(entityId);
					if (updates.length === maxBatchSize) {
						break;
					}
				}
				const running: RunningFiber = { fiber: undefined };
				inFlight = running;
				const fiber = runFork(
					options.onBatch(updates).pipe(
						Effect.catch((error) => reportBatchError(error)),
						Effect.ensuring(
							Effect.suspend(() => {
								if (inFlight !== running) {
									return Effect.void;
								}
								inFlight = undefined;
								if (disposed) {
									return Effect.void;
								}
								if (pending.size === 0) {
									return options.onDrain ? Effect.sync(options.onDrain) : Effect.void;
								}
								if (blocked) {
									return Effect.void;
								}
								return windowElapsed || !window ? flush : Effect.void;
							}),
						),
					),
				);
				if (inFlight === running) {
					running.fiber = fiber;
				}
			});

			const push = Effect.fn("EntityUpdateBatcher.push")(function* (
				update: EntityInterestEntityUpdatedMessage,
			) {
				if (disposed) {
					return;
				}
				pending.set(update.entityId, update);
				if (blocked) {
					return;
				}
				if (pending.size >= maxBatchSize) {
					windowElapsed = true;
					yield* flush;
					return;
				}
				startWindow();
			});

			const setBlocked = Effect.fn("EntityUpdateBatcher.setBlocked")(function* (
				nextBlocked: boolean,
			) {
				if (disposed || blocked === nextBlocked) {
					return;
				}
				blocked = nextBlocked;
				if (nextBlocked) {
					const runningWindow = window;
					window = undefined;
					windowElapsed = false;
					if (runningWindow?.fiber) {
						yield* Fiber.interrupt(runningWindow.fiber);
					}
					return;
				}
				if (pending.size > 0) {
					windowElapsed = true;
					yield* flush;
				}
			});

			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					disposed = true;
					window = undefined;
					inFlight = undefined;
					pending.clear();
				}),
			);

			return EntityUpdateBatcher.of({ push, setBlocked });
		});

	static readonly layer = (options: EntityUpdateBatcherOptions) =>
		Layer.effect(this, this.make(options));
}

const defaultReportBatchError = (error: unknown) => {
	globalThis.console.error("entity update batch failed", error);
};
