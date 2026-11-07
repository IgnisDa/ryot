import {
	type EntityUpdatedFrame,
	MAX_FOREGROUND_ENTITY_IDS,
	MAX_INTEREST_ENTITY_IDS,
	MAX_POPULATE_ENTITY_IDS,
	type PopulateEntitiesBody,
} from "@ryot-app/contract/modules/live-updates/messages";
import type { EntityWatch, RyotClient } from "@ryot-app/plugin-client-sdk";
import type { Fiber } from "effect";
import { Array as Arr, Context, Effect, FiberSet, Layer, PubSub, Stream } from "effect";

import { LiveUpdatesApi } from "#/api/live-updates";
import { type ApiScope, apiScopeKey } from "#/api/scope";

import { EntityWatchTransport } from "./transport";

export type WatchEntities = RyotClient["entities"]["watch"];

type Priority = PopulateEntitiesBody["priority"];

type Owner = {
	interest: EntityWatch;
	readonly active: () => boolean;
	readonly onUpdate: Parameters<WatchEntities>[1];
};

const ASK_DELAY_MS = 100;

export class EntityWatchService extends Context.Service<EntityWatchService>()(
	"@ryot-app/kernel-client/modules/entity-watches/service/EntityWatchService",
	{
		make: Effect.gen(function* () {
			const api = yield* LiveUpdatesApi;
			const io = yield* EntityWatchTransport;
			const run = yield* FiberSet.makeRuntime();
			const declarations = new Map<string, Set<Owner>>();
			const derivedData = yield* PubSub.unbounded<string>();
			const derivedDataUpdated = (key: string) => {
				PubSub.publishUnsafe(derivedData, key);
			};
			const derivedDataUpdates = (scope: ApiScope) => {
				const key = apiScopeKey(scope);
				return Stream.fromPubSub(derivedData).pipe(
					Stream.filter((updated) => updated === key),
					Stream.map(() => undefined),
				);
			};
			let active:
				| undefined
				| {
						key: string;
						release: () => void;
						refresh: () => void;
						reconnect: () => void;
						retain: () => () => void;
				  };

			const watch = (
				scope: ApiScope,
				interest: EntityWatch,
				onUpdate: Owner["onUpdate"],
				isActive: () => boolean = () => true,
			) => {
				const key = apiScopeKey(scope);
				const owners = declarations.get(key) ?? new Set<Owner>();
				declarations.set(key, owners);
				const owner = { interest, onUpdate, active: isActive };
				owners.add(owner);
				if (active?.key === key) {
					active.refresh();
				}
				return {
					update: (next: EntityWatch) => {
						if (declarations.get(key) !== owners || !owners.has(owner)) {
							return;
						}
						owner.interest = next;
						if (active?.key === key) {
							active.refresh();
						}
					},
					dispose: () => {
						if (declarations.get(key) !== owners || !owners.delete(owner)) {
							return;
						}
						if (active?.key === key) {
							active.refresh();
						} else if (!owners.size) {
							declarations.delete(key);
						}
					},
				};
			};

			const acquire = (scope: ApiScope) => {
				const key = apiScopeKey(scope);
				if (active?.key === key) {
					return active.retain();
				}
				active?.release();
				for (const other of declarations.keys()) {
					if (other !== key) {
						declarations.delete(other);
					}
				}
				let leases = 0;
				let attempt = 0;
				let failures = 0;
				let connectedBefore = false;
				let disposed = false;
				let reportedOverflow = false;
				let batch: undefined | (() => void);
				let retry: undefined | (() => void);
				let streamFiber: undefined | Fiber.Fiber<void>;
				let selection = new Map<string, Priority>();
				// What the server was last asked about these entities, so unchanged pages cost no request.
				const asked = new Map<string, Priority>();

				const stop = () => {
					attempt++;
					streamFiber?.interruptUnsafe();
					streamFiber = undefined;
					retry?.();
					retry = undefined;
				};
				const failed = () => {
					stop();
					if (disposed || !io.available()) {
						return;
					}
					retry = io.schedule(Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)), connect);
				};
				const ask = (priority: Priority, entityIds: ReadonlyArray<string>) => {
					for (const chunk of Arr.chunksOf(entityIds, MAX_POPULATE_ENTITY_IDS)) {
						run(
							api.populate(scope, { priority, entityIds: chunk }).pipe(
								Effect.catchCause(() =>
									Effect.sync(() => {
										for (const id of chunk) {
											asked.delete(id);
										}
									}),
								),
							),
						);
					}
				};
				const flush = () => {
					batch = undefined;
					if (disposed || !io.available()) {
						return;
					}
					const unasked = [...selection].filter(([id, priority]) => {
						const previous = asked.get(id);
						return (
							previous === undefined || (previous === "background" && priority === "interactive")
						);
					});
					for (const [id, priority] of unasked) {
						asked.set(id, priority);
					}
					const idsAt = (level: Priority) =>
						unasked.flatMap(([id, priority]) => (priority === level ? [id] : []));
					ask("interactive", idsAt("interactive"));
					ask("background", idsAt("background"));
				};
				const schedule = () => {
					batch ??= io.schedule(ASK_DELAY_MS, flush);
				};
				const refresh = () => {
					if (disposed) {
						return;
					}
					const owners = [...(declarations.get(key) ?? [])];
					const activeOwners = owners.filter((owner) => owner.active());
					const selected = new Set(
						[activeOwners, owners.filter((owner) => !owner.active())].flatMap((group) =>
							(["foreground", "visible"] as const).flatMap((priority) =>
								[...new Set(group.flatMap((owner) => owner.interest[priority]))].sort(),
							),
						),
					);
					if (selected.size > MAX_INTEREST_ENTITY_IDS && !reportedOverflow) {
						reportedOverflow = true;
						io.reportOverflow(selected.size - MAX_INTEREST_ENTITY_IDS);
					}
					const ids = [...selected].slice(0, MAX_INTEREST_ENTITY_IDS);
					const foreground = new Set(
						[...new Set(activeOwners.flatMap((owner) => owner.interest.foreground))]
							.sort()
							.slice(0, MAX_FOREGROUND_ENTITY_IDS),
					);
					selection = new Map(
						ids.map((id) => [id, foreground.has(id) ? "interactive" : "background"]),
					);
					for (const id of asked.keys()) {
						if (!selection.has(id)) {
							asked.delete(id);
						}
					}
					schedule();
				};
				const entityUpdated = (frame: EntityUpdatedFrame) => {
					// A finished step may leave more for a page that is still open, such as related pages or a translation.
					if (
						frame.reason === "populated" ||
						(frame.reason === "enrichment-updated" &&
							selection.get(frame.entityId) === "interactive")
					) {
						asked.delete(frame.entityId);
						schedule();
					}
					for (const owner of declarations.get(key) ?? []) {
						if (
							owner.interest.foreground.includes(frame.entityId) ||
							owner.interest.visible.includes(frame.entityId)
						) {
							try {
								owner.onUpdate({ reason: frame.reason, entityId: frame.entityId });
							} catch {
								/* A listener must not stop transport. */
							}
						}
					}
				};
				function connect() {
					stop();
					if (disposed || !io.available()) {
						return;
					}
					const current = attempt;
					const isCurrent = () => !disposed && current === attempt;
					streamFiber = run(
						api
							.events(scope, {
								onFrame: (frame) => {
									if (!isCurrent()) {
										return;
									}
									if (frame.type === "derived-data-updated") {
										derivedDataUpdated(key);
										return;
									}
									entityUpdated(frame);
								},
								onConnected: () => {
									if (!isCurrent()) {
										return;
									}
									failures = 0;
									if (connectedBefore) {
										derivedDataUpdated(key);
									}
									connectedBefore = true;
									asked.clear();
									schedule();
								},
							})
							.pipe(
								Effect.catchCause(() =>
									Effect.sync(() => {
										if (isCurrent()) {
											failed();
										}
									}),
								),
							),
					);
				}
				const unsubscribe = io.subscribe(connect);
				const release = () => {
					if (disposed) {
						return;
					}
					disposed = true;
					stop();
					batch?.();
					unsubscribe();
					declarations.delete(key);
					if (active?.release === release) {
						active = undefined;
					}
				};
				const retain = () => {
					leases++;
					let released = false;
					return () => {
						if (released || disposed) {
							return;
						}
						released = true;
						if (--leases === 0) {
							release();
						}
					};
				};
				active = { key, retain, release, refresh, reconnect: connect };
				refresh();
				connect();
				return retain();
			};
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					active?.release();
					declarations.clear();
				}).pipe(Effect.andThen(PubSub.shutdown(derivedData))),
			);
			return {
				watch,
				acquire,
				derivedDataUpdates,
				refresh: (scope: ApiScope) => {
					if (active?.key === apiScopeKey(scope)) {
						active.refresh();
					}
				},
				reconnect: (scope: ApiScope) => {
					if (active?.key === apiScopeKey(scope)) {
						active.reconnect();
					}
				},
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
