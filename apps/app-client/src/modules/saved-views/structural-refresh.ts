import { Cause, Clock, Context, Effect, Exit, Fiber, FiberSet, Layer } from "effect";

const STRUCTURAL_DIRTY_MAX_MS = 30_000;

type RunningFiber = {
	fiber: Fiber.Fiber<void> | undefined;
};

type StructuralEntry = {
	manual: boolean;
	pending: boolean;
	retryAt: number | undefined;
	timer: RunningFiber | undefined;
	refresh: RunningFiber | undefined;
	request: SavedViewStructuralRequest | undefined;
};

export type SavedViewStructuralRequest = {
	readonly key: string;
	readonly canStart: () => boolean;
	readonly onEnd: Effect.Effect<void>;
	readonly run: Effect.Effect<boolean, unknown>;
	readonly onStart: (manual: boolean) => Effect.Effect<void>;
};

export class SavedViewStructuralRefresh extends Context.Service<
	SavedViewStructuralRefresh,
	{
		readonly activate: (request: SavedViewStructuralRequest) => Effect.Effect<void>;
		readonly markDirty: (request: SavedViewStructuralRequest) => Effect.Effect<void>;
		readonly refresh: (request: SavedViewStructuralRequest, manual: boolean) => Effect.Effect<void>;
	}
>()("ryot/app-client/saved-views/SavedViewStructuralRefresh") {
	static readonly make = Effect.gen(function* () {
		let disposed = false;
		const entries = new Map<string, StructuralEntry>();
		const runFork = yield* FiberSet.makeRuntime<never, void, never>();

		const entryFor = (key: string) => {
			const current = entries.get(key);
			if (current) {
				return current;
			}
			const entry: StructuralEntry = {
				manual: false,
				pending: false,
				timer: undefined,
				request: undefined,
				retryAt: undefined,
				refresh: undefined,
			};
			entries.set(key, entry);
			return entry;
		};

		let startRefresh: (request: SavedViewStructuralRequest, manual: boolean) => Effect.Effect<void>;

		const scheduleRetry = (entry: StructuralEntry) => {
			if (disposed || entry.timer || entry.refresh || entry.retryAt === undefined) {
				return;
			}
			const retryAt = entry.retryAt;
			const running: RunningFiber = { fiber: undefined };
			entry.timer = running;
			const fiber = runFork(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					yield* Effect.sleep(Math.max(0, retryAt - now));
					if (disposed || entry.timer !== running) {
						return;
					}
					entry.timer = undefined;
					entry.retryAt = undefined;
					const request = entry.request;
					if (request) {
						yield* startRefresh(request, entry.manual);
					}
				}),
			);
			if (entry.timer === running) {
				running.fiber = fiber;
			}
		};

		startRefresh = Effect.fn("SavedViewStructuralRefresh.refresh")(function* (
			request: SavedViewStructuralRequest,
			manual: boolean,
		) {
			const entry = entryFor(request.key);
			entry.request = request;
			entry.manual ||= manual;
			entry.pending = true;
			if (disposed || entry.refresh || !request.canStart()) {
				return;
			}
			const timer = entry.timer;
			const running: RunningFiber = { fiber: undefined };
			const pendingManual = entry.manual;
			entry.manual = false;
			entry.pending = false;
			entry.timer = undefined;
			entry.retryAt = undefined;
			entry.refresh = running;
			if (timer?.fiber) {
				yield* Fiber.interrupt(timer.fiber);
			}
			const fiber = runFork(
				Effect.gen(function* () {
					yield* request.onStart(pendingManual);
					const result = yield* Effect.exit(request.run);
					if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) {
						return;
					}
					yield* request.onEnd;
					if (entry.refresh !== running) {
						return;
					}
					entry.refresh = undefined;
					if (disposed) {
						return;
					}
					const pendingRequest = entry.request;
					if (entry.pending && pendingRequest) {
						yield* startRefresh(pendingRequest, entry.manual);
						return;
					}
					if (Exit.isSuccess(result) && result.value) {
						return;
					}
					entry.pending = true;
					entry.retryAt = (yield* Clock.currentTimeMillis) + STRUCTURAL_DIRTY_MAX_MS;
					scheduleRetry(entry);
					if (Exit.isFailure(result)) {
						yield* Effect.logWarning(
							"saved-view structural refresh failed",
							Cause.pretty(result.cause),
						);
					}
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							if (entry.refresh === running) {
								entry.refresh = undefined;
							}
						}),
					),
				),
			);
			if (entry.refresh === running) {
				running.fiber = fiber;
			}
		});

		const activate = Effect.fn("SavedViewStructuralRefresh.activate")(function* (
			request: SavedViewStructuralRequest,
		) {
			const entry = entryFor(request.key);
			entry.request = request;
			if (!entry.pending) {
				return;
			}
			if (entry.retryAt !== undefined) {
				scheduleRetry(entry);
				return;
			}
			yield* startRefresh(request, entry.manual);
		});

		const markDirty = Effect.fn("SavedViewStructuralRefresh.markDirty")(function* (
			request: SavedViewStructuralRequest,
		) {
			const entry = entryFor(request.key);
			entry.request = request;
			entry.pending = true;
			if (entry.refresh) {
				return;
			}
			entry.retryAt ??= (yield* Clock.currentTimeMillis) + STRUCTURAL_DIRTY_MAX_MS;
			scheduleRetry(entry);
		});

		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				disposed = true;
				entries.clear();
			}),
		);

		return SavedViewStructuralRefresh.of({
			activate,
			markDirty,
			refresh: startRefresh,
		});
	});

	static readonly layer = Layer.effect(this, this.make);
}
