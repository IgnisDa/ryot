import {
	MAX_INTEREST_ENTITY_IDS,
	type EntityInterestClientMessage,
	type EntityInterestEntityUpdatedMessage,
} from "@ryot/contract/modules/entity-interest/messages";
import { Context, Duration, Effect, FiberSet, Layer } from "effect";

export type EntityInterestPriority = "foreground" | "visible" | "prefetch";

type SendMessage = (message: EntityInterestClientMessage) => Effect.Effect<void>;
type UpdateListener = (message: EntityInterestEntityUpdatedMessage) => void;

type Interest = {
	readonly entityIds: Set<string>;
	readonly priority: EntityInterestPriority;
};

type ActiveCommand = {
	readonly revision: number;
	readonly entityIds: Set<string>;
};

type SocketSession = {
	revision: number;
	readonly send: SendMessage;
	appliedEntityIds: Set<string>;
	active: ActiveCommand | undefined;
};

type SelectionOverflow = {
	readonly omittedCount: number;
	readonly counts: Readonly<Record<EntityInterestPriority, number>>;
};

type EntityInterestCoordinatorOptions = {
	readonly onSelectionOverflow?: (overflow: SelectionOverflow) => void;
};

const INTEREST_BATCH_WINDOW = Duration.millis(100);
const INTEREST_REMOVAL_GRACE = Duration.seconds(2);
const priorities = ["foreground", "visible", "prefetch"] as const;

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
	left.size === right.size && [...left].every((entityId) => right.has(entityId));

export class EntityInterestCoordinator extends Context.Service<
	EntityInterestCoordinator,
	{
		readonly connect: (send: SendMessage) => Effect.Effect<void>;
		readonly removeInterest: (owner: string) => Effect.Effect<void>;
		readonly disconnect: (send: SendMessage) => Effect.Effect<void>;
		readonly acknowledge: (send: SendMessage, revision: number) => Effect.Effect<void>;
		readonly receive: (message: EntityInterestEntityUpdatedMessage) => Effect.Effect<void>;
		readonly setInterest: (
			owner: string,
			entityIds: readonly string[],
			priority: EntityInterestPriority,
			listener: UpdateListener,
		) => Effect.Effect<void>;
	}
>()("ryot/app-client/entity-interest/EntityInterestCoordinator") {
	static readonly make = (options: EntityInterestCoordinatorOptions = {}) =>
		Effect.gen(function* () {
			let dirty = false;
			let disposed = false;
			let batchToken: object | undefined;
			let session: SocketSession | undefined;
			let selectedEntityIds = new Set<string>();
			const effectiveEntityIds = new Set<string>();
			const interests = new Map<string, Interest>();
			const removalTokens = new Map<string, object>();
			const ownersByEntity = new Map<string, Set<string>>();
			const listenersByOwner = new Map<string, UpdateListener>();
			const runFork = yield* FiberSet.makeRuntime<never, void, never>();

			const sendNext = () => {
				if (disposed || !dirty || batchToken || !session || session.active) {
					return;
				}
				dirty = false;
				const entityIds = new Set(effectiveEntityIds);
				const add = [...entityIds].filter((entityId) => !session?.appliedEntityIds.has(entityId));
				const remove = [...session.appliedEntityIds].filter((entityId) => !entityIds.has(entityId));
				if (add.length === 0 && remove.length === 0) {
					return;
				}
				const revision = session.revision + 1;
				session.active = { entityIds, revision };
				runFork(session.send({ revision, type: "update", add: add.sort(), remove: remove.sort() }));
			};

			const requestBatch = () => {
				dirty = true;
				if (batchToken) {
					return;
				}
				const token = {};
				batchToken = token;
				runFork(
					Effect.sleep(INTEREST_BATCH_WINDOW).pipe(
						Effect.andThen(
							Effect.sync(() => {
								if (batchToken !== token) {
									return;
								}
								batchToken = undefined;
								sendNext();
							}),
						),
					),
				);
			};

			const requestImmediate = () => {
				dirty = true;
				batchToken = undefined;
				sendNext();
			};

			const selectEntityIds = () => {
				const priorityByEntity = new Map<string, EntityInterestPriority>();
				for (const interest of interests.values()) {
					for (const entityId of interest.entityIds) {
						const current = priorityByEntity.get(entityId);
						if (!current || priorities.indexOf(interest.priority) < priorities.indexOf(current)) {
							priorityByEntity.set(entityId, interest.priority);
						}
					}
				}
				const grouped = {
					visible: [] as string[],
					prefetch: [] as string[],
					foreground: [] as string[],
				};
				for (const [entityId, priority] of priorityByEntity) {
					grouped[priority].push(entityId);
				}
				for (const priority of priorities) {
					grouped[priority].sort();
				}
				const all = priorities.flatMap((priority) => grouped[priority]);
				if (all.length > MAX_INTEREST_ENTITY_IDS) {
					(options.onSelectionOverflow ?? reportSelectionOverflow)({
						omittedCount: all.length - MAX_INTEREST_ENTITY_IDS,
						counts: {
							visible: grouped.visible.length,
							prefetch: grouped.prefetch.length,
							foreground: grouped.foreground.length,
						},
					});
				}
				return new Set(all.slice(0, MAX_INTEREST_ENTITY_IDS));
			};

			const refreshSelection = () => {
				const nextSelected = selectEntityIds();
				if (sameSet(selectedEntityIds, nextSelected)) {
					return;
				}
				selectedEntityIds = nextSelected;
				let added = false;
				for (const entityId of nextSelected) {
					removalTokens.delete(entityId);
					if (!effectiveEntityIds.has(entityId)) {
						if (effectiveEntityIds.size === MAX_INTEREST_ENTITY_IDS) {
							const omitted = [...effectiveEntityIds].find((current) => !nextSelected.has(current));
							if (omitted) {
								removalTokens.delete(omitted);
								effectiveEntityIds.delete(omitted);
							}
						}
						effectiveEntityIds.add(entityId);
						added = true;
					}
				}
				for (const entityId of effectiveEntityIds) {
					if (nextSelected.has(entityId) || removalTokens.has(entityId)) {
						continue;
					}
					const token = {};
					removalTokens.set(entityId, token);
					runFork(
						Effect.sleep(INTEREST_REMOVAL_GRACE).pipe(
							Effect.andThen(
								Effect.sync(() => {
									if (removalTokens.get(entityId) !== token || selectedEntityIds.has(entityId)) {
										return;
									}
									removalTokens.delete(entityId);
									effectiveEntityIds.delete(entityId);
									requestImmediate();
								}),
							),
						),
					);
				}
				if (added) {
					requestBatch();
				}
			};

			const emit = (message: EntityInterestEntityUpdatedMessage) => {
				if (disposed || !session) {
					return;
				}
				for (const owner of ownersByEntity.get(message.entityId) ?? []) {
					listenersByOwner.get(owner)?.(message);
				}
			};

			const removeOwnerFromEntityIndex = (owner: string, entityIds: ReadonlySet<string>) => {
				for (const entityId of entityIds) {
					const owners = ownersByEntity.get(entityId);
					owners?.delete(owner);
					if (owners?.size === 0) {
						ownersByEntity.delete(entityId);
					}
				}
			};

			const connect = Effect.fn("EntityInterestCoordinator.connect")(function* (send: SendMessage) {
				if (disposed) {
					return;
				}
				batchToken = undefined;
				dirty = false;
				session = {
					send,
					revision: 0,
					appliedEntityIds: new Set(),
					active: { revision: 1, entityIds: new Set(effectiveEntityIds) },
				};
				yield* send({
					revision: 1,
					type: "replace",
					entityIds: [...effectiveEntityIds].sort(),
				});
			});

			const disconnect = (send: SendMessage) =>
				Effect.sync(() => {
					if (session?.send === send) {
						session = undefined;
					}
				});

			const acknowledge = (send: SendMessage, revision: number) =>
				Effect.sync(() => {
					if (!session || session.send !== send) {
						return;
					}
					if (!session.active || session.active.revision !== revision) {
						throw new Error("Entity interest acknowledgement revision mismatch");
					}
					session.revision = revision;
					session.appliedEntityIds = session.active.entityIds;
					session.active = undefined;
					sendNext();
				});

			const setInterest = (
				owner: string,
				entityIds: readonly string[],
				priority: EntityInterestPriority,
				listener: UpdateListener,
			) =>
				Effect.sync(() => {
					if (disposed) {
						return;
					}
					const next = new Set(entityIds);
					const current = interests.get(owner);
					listenersByOwner.set(owner, listener);
					if (current?.priority === priority && sameSet(current.entityIds, next)) {
						return;
					}
					if (current) {
						removeOwnerFromEntityIndex(owner, current.entityIds);
					}
					interests.set(owner, { priority, entityIds: next });
					for (const entityId of next) {
						const owners = ownersByEntity.get(entityId) ?? new Set<string>();
						owners.add(owner);
						ownersByEntity.set(entityId, owners);
					}
					refreshSelection();
				});

			const removeInterest = (owner: string) =>
				Effect.sync(() => {
					if (disposed) {
						return;
					}
					const current = interests.get(owner);
					if (!current) {
						return;
					}
					removeOwnerFromEntityIndex(owner, current.entityIds);
					interests.delete(owner);
					listenersByOwner.delete(owner);
					refreshSelection();
				});

			const receive = (message: EntityInterestEntityUpdatedMessage) =>
				Effect.sync(() => emit(message));

			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					disposed = true;
					session = undefined;
					interests.clear();
					removalTokens.clear();
					ownersByEntity.clear();
					effectiveEntityIds.clear();
					listenersByOwner.clear();
				}),
			);

			return EntityInterestCoordinator.of({
				receive,
				connect,
				disconnect,
				setInterest,
				acknowledge,
				removeInterest,
			});
		});

	static readonly layer = (options: EntityInterestCoordinatorOptions = {}) =>
		Layer.effect(this, this.make(options));
}

const reportSelectionOverflow = (overflow: SelectionOverflow) => {
	globalThis.console.warn("entity interest selection omitted IDs", overflow);
};
