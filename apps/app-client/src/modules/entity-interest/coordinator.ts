import {
	MAX_INTEREST_ENTITY_IDS,
	type EntityUpdatedFrame,
} from "@ryot/contract/modules/entity-interest/messages";
import { Cause, Context, Effect, Exit, Fiber, FiberSet, Layer } from "effect";

type DeclareInterest = (
	streamId: string,
	entityIds: readonly string[],
) => Effect.Effect<readonly EntityUpdatedFrame[], unknown>;

type UpdateListener = (frame: EntityUpdatedFrame) => void;

type DeclarationFailure = (
	error: unknown,
	attempt: number,
	retryDelayMs: number,
) => Effect.Effect<void>;

type EntityInterestCoordinatorOptions = {
	readonly declareInterest: DeclareInterest;
	readonly onDeclarationFailure?: DeclarationFailure;
};

type ActiveDeclaration = {
	fiber: Fiber.Fiber<void> | undefined;
};

export class EntityInterestCoordinator extends Context.Service<
	EntityInterestCoordinator,
	{
		readonly disconnect: (streamId: string) => Effect.Effect<void>;
		readonly removeInterest: (owner: string) => Effect.Effect<void>;
		readonly receive: (frame: EntityUpdatedFrame) => Effect.Effect<void>;
		readonly setConnection: (streamId: string | undefined) => Effect.Effect<void>;
		readonly setInterest: (
			owner: string,
			entityIds: readonly string[],
			listener: UpdateListener,
		) => Effect.Effect<void>;
	}
>()("ryot/app-client/entity-interest/EntityInterestCoordinator") {
	static readonly make = (options: EntityInterestCoordinatorOptions) =>
		Effect.gen(function* () {
			let dirty = false;
			let disposed = false;
			let streamId: string | undefined;
			let active: ActiveDeclaration | undefined;
			const interests = new Map<string, Set<string>>();
			const ownersByEntity = new Map<string, Set<string>>();
			const listenersByOwner = new Map<string, UpdateListener>();
			const runFork = yield* FiberSet.makeRuntime<never, void, never>();

			const currentEntityIds = () => {
				const entityIds = new Set<string>();
				for (const interest of interests.values()) {
					for (const entityId of interest) {
						entityIds.add(entityId);
						if (entityIds.size === MAX_INTEREST_ENTITY_IDS) {
							return [...entityIds];
						}
					}
				}
				return [...entityIds];
			};

			const emit = (frame: EntityUpdatedFrame) => {
				if (disposed) {
					return;
				}
				const owners = ownersByEntity.get(frame.entityId);
				if (!owners) {
					return;
				}
				for (const owner of owners) {
					listenersByOwner.get(owner)?.(frame);
				}
			};

			const removeOwnerFromEntityIndex = (owner: string, entityIds: ReadonlySet<string>) => {
				for (const entityId of entityIds) {
					const owners = ownersByEntity.get(entityId);
					if (!owners) {
						continue;
					}
					owners.delete(owner);
					if (owners.size === 0) {
						ownersByEntity.delete(entityId);
					}
				}
			};

			let startDeclaration: () => void;
			const flush = (work: ActiveDeclaration) =>
				Effect.gen(function* () {
					let failures = 0;
					while (dirty) {
						if (disposed || !streamId || active !== work) {
							return;
						}
						dirty = false;
						const connection = streamId;
						const result = yield* Effect.exit(
							options.declareInterest(connection, currentEntityIds()),
						);
						if (disposed || active !== work || streamId !== connection) {
							return;
						}
						if (Exit.isSuccess(result)) {
							failures = 0;
							for (const frame of result.value) {
								emit(frame);
							}
							continue;
						}
						if (Cause.hasInterruptsOnly(result.cause)) {
							return;
						}
						dirty = true;
						failures += 1;
						const retryDelayMs = Math.min(1_000 * 2 ** (failures - 1), 30_000);
						if (options.onDeclarationFailure) {
							yield* options.onDeclarationFailure(
								Cause.squash(result.cause),
								failures,
								retryDelayMs,
							);
						}
						yield* Effect.sleep(retryDelayMs);
					}
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							if (active === work) {
								active = undefined;
								startDeclaration();
							}
						}),
					),
				);

			startDeclaration = () => {
				if (disposed || active || !dirty || !streamId) {
					return;
				}
				const work: ActiveDeclaration = { fiber: undefined };
				active = work;
				const fiber = runFork(flush(work));
				if (active === work) {
					work.fiber = fiber;
				}
			};

			const requestDeclaration = () => {
				if (!disposed) {
					dirty = true;
					startDeclaration();
				}
			};

			const setConnection = Effect.fn("EntityInterestCoordinator.setConnection")(function* (
				nextStreamId: string | undefined,
			) {
				if (disposed || streamId === nextStreamId) {
					return;
				}
				const previous = active;
				active = undefined;
				streamId = nextStreamId;
				if (nextStreamId) {
					requestDeclaration();
				} else {
					dirty = false;
				}
				if (previous?.fiber) {
					yield* Fiber.interrupt(previous.fiber);
				}
			});

			const disconnect = Effect.fn("EntityInterestCoordinator.disconnect")(function* (
				endedStreamId: string,
			) {
				if (streamId === endedStreamId) {
					yield* setConnection(undefined);
				}
			});

			const setInterest = (owner: string, entityIds: readonly string[], listener: UpdateListener) =>
				Effect.sync(() => {
					if (disposed) {
						return;
					}
					const next = new Set(entityIds);
					const current = interests.get(owner);
					listenersByOwner.set(owner, listener);
					if (current && current.size === next.size && [...current].every((id) => next.has(id))) {
						return;
					}
					if (current) {
						removeOwnerFromEntityIndex(owner, current);
					}
					interests.set(owner, next);
					for (const entityId of next) {
						const owners = ownersByEntity.get(entityId) ?? new Set<string>();
						owners.add(owner);
						ownersByEntity.set(entityId, owners);
					}
					requestDeclaration();
				});

			const removeInterest = (owner: string) =>
				Effect.sync(() => {
					if (disposed) {
						return;
					}
					const current = interests.get(owner);
					if (current) {
						removeOwnerFromEntityIndex(owner, current);
						interests.delete(owner);
						listenersByOwner.delete(owner);
						requestDeclaration();
					}
				});

			const receive = (frame: EntityUpdatedFrame) =>
				Effect.sync(() => {
					if (!disposed && streamId) {
						emit(frame);
					}
				});

			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					disposed = true;
					dirty = false;
					streamId = undefined;
					active = undefined;
					interests.clear();
					ownersByEntity.clear();
					listenersByOwner.clear();
				}),
			);

			return EntityInterestCoordinator.of({
				receive,
				disconnect,
				setInterest,
				setConnection,
				removeInterest,
			});
		});

	static readonly layer = (options: EntityInterestCoordinatorOptions) =>
		Layer.effect(this, this.make(options));
}
