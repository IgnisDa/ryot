import type { EntityInterest, RyotClient } from "@ryot-app/client-sdk";
import {
	MAX_INTEREST_ENTITY_IDS,
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
	type EntityInterestClientMessage,
} from "@ryot-app/contract/modules/entity-interest/messages";
import { Context, Effect, Layer, Match, Result } from "effect";

import { EntityInterestApi, entityInterestSocketUrl } from "#/api/entity-interest";
import { apiScopeKey, type ApiScope } from "#/api/scope";

import { EntityInterestTransport, type InterestSocket } from "./transport";

export type WatchEntities = RyotClient["entities"]["watch"];

type Owner = { interest: EntityInterest; readonly onUpdate: Parameters<WatchEntities>[1] };

export class EntityInterestService extends Context.Service<EntityInterestService>()(
	"EntityInterestService",
	{
		make: Effect.gen(function* () {
			const api = yield* EntityInterestApi;
			const io = yield* EntityInterestTransport;
			const declarations = new Map<string, Set<Owner>>();
			let active:
				| {
						key: string;
						release: () => void;
						refresh: () => void;
						reconnect: () => void;
						retain: () => () => void;
				  }
				| undefined;

			const watch = (scope: ApiScope, interest: EntityInterest, onUpdate: Owner["onUpdate"]) => {
				const key = apiScopeKey(scope);
				const owners = declarations.get(key) ?? new Set<Owner>();
				declarations.set(key, owners);
				const owner = { interest, onUpdate };
				owners.add(owner);
				if (active?.key === key) {
					active.refresh();
				}
				return {
					update: (next: EntityInterest) => {
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
				let revision = 0;
				let ready = false;
				let disposed = false;
				let heartbeatMs = 90_000;
				let reportedOverflow = false;
				let applied = new Set<string>();
				let effective = new Set<string>();
				let batch: (() => void) | undefined;
				let retry: (() => void) | undefined;
				let socket: InterestSocket | undefined;
				let deadline: (() => void) | undefined;
				const grace = new Map<string, () => void>();
				let controller: AbortController | undefined;
				let socketListeners: AbortController | undefined;
				let pending: { revision: number; ids: Set<string> } | undefined;

				const stop = () => {
					attempt++;
					controller?.abort();
					controller = undefined;
					retry?.();
					retry = undefined;
					deadline?.();
					deadline = undefined;
					const previous = socket;
					socketListeners?.abort();
					socketListeners = undefined;
					socket = undefined;
					ready = false;
					pending = undefined;
					if (previous) {
						try {
							previous.close();
						} catch {
							/* Already unavailable. */
						}
					}
				};
				const failed = () => {
					stop();
					if (disposed || !io.available()) {
						return;
					}
					retry = io.schedule(Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)), connect);
				};
				const send = (message: EntityInterestClientMessage) => {
					try {
						socket?.send(encodeEntityInterestClientMessage(message));
					} catch {
						failed();
					}
				};
				const flush = () => {
					if (!ready || pending || batch || disposed) {
						return;
					}
					const ids = new Set(effective);
					const add = [...ids].filter((id) => !applied.has(id)).sort();
					const remove = [...applied].filter((id) => !ids.has(id)).sort();
					if (revision && !add.length && !remove.length) {
						return;
					}
					pending = { ids, revision: revision + 1 };
					send(
						revision === 0
							? { type: "replace", revision: 1, entityIds: [...ids].sort() }
							: { type: "update", revision: revision + 1, add, remove },
					);
				};
				const refresh = () => {
					if (disposed) {
						return;
					}
					const owners = [...(declarations.get(key) ?? [])];
					const selected = new Set(
						(["foreground", "visible"] as const).flatMap((priority) =>
							[...new Set(owners.flatMap((owner) => owner.interest[priority]))].sort(),
						),
					);
					const next = new Set([...selected].slice(0, MAX_INTEREST_ENTITY_IDS));
					if (selected.size > MAX_INTEREST_ENTITY_IDS && !reportedOverflow) {
						reportedOverflow = true;
						io.reportOverflow(selected.size - MAX_INTEREST_ENTITY_IDS);
					}
					for (const [id, removal] of grace) {
						if (next.has(id)) {
							removal();
							grace.delete(id);
						}
					}
					for (const id of effective) {
						if (!next.has(id) && !grace.has(id)) {
							grace.set(
								id,
								io.schedule(2000, () => {
									grace.delete(id);
									effective.delete(id);
									flush();
								}),
							);
						}
					}
					for (const [id, removal] of grace) {
						if (next.size < MAX_INTEREST_ENTITY_IDS) {
							next.add(id);
						} else {
							removal();
							grace.delete(id);
						}
					}
					const changed =
						next.size !== effective.size || [...next].some((id) => !effective.has(id));
					effective = next;
					if (changed && !batch) {
						batch = io.schedule(100, () => {
							batch = undefined;
							flush();
						});
					}
				};
				function connect() {
					stop();
					if (disposed || !io.available()) {
						return;
					}
					const current = attempt;
					controller = new AbortController();
					deadline = io.schedule(15_000, failed);
					void Effect.runPromise(api.createSocketTicket(scope), { signal: controller.signal })
						.then(({ ticket }) => {
							if (disposed || current !== attempt) {
								return undefined;
							}
							const connection = io.open(entityInterestSocketUrl(scope));
							socket = connection;
							const isCurrent = () => !disposed && socket === connection && current === attempt;
							socketListeners = new AbortController();
							const options = { signal: socketListeners.signal };
							connection.addEventListener(
								"open",
								() => {
									if (isCurrent()) {
										send({ type: "authenticate", ticket });
									}
								},
								options,
							);
							const onFailure = () => {
								if (isCurrent()) {
									failed();
								}
							};
							connection.addEventListener("close", onFailure, options);
							connection.addEventListener("error", onFailure, options);
							connection.addEventListener(
								"message",
								(event) => {
									if (!isCurrent()) {
										return;
									}
									const decoded = decodeEntityInterestServerMessage(
										event instanceof MessageEvent ? event.data : undefined,
									);
									if (Result.isFailure(decoded) || (!ready && decoded.success.type !== "ready")) {
										failed();
										return;
									}
									Match.value(decoded.success).pipe(
										Match.when({ type: "ready" }, (message) => {
											if (
												ready ||
												message.maxEntityIds < MAX_INTEREST_ENTITY_IDS ||
												message.heartbeatIntervalMs <= 0
											) {
												failed();
												return;
											}
											ready = true;
											failures = revision = 0;
											applied = new Set();
											deadline?.();
											heartbeatMs = message.heartbeatIntervalMs * 3;
											deadline = io.schedule(heartbeatMs, failed);
											batch?.();
											batch = undefined;
											flush();
										}),
										Match.when({ type: "applied" }, (message) => {
											if (pending?.revision !== message.revision) {
												failed();
												return;
											}
											applied = pending.ids;
											revision = pending.revision;
											pending = undefined;
											flush();
										}),
										Match.when({ type: "ping" }, ({ nonce }) => {
											deadline?.();
											deadline = io.schedule(heartbeatMs, failed);
											send({ type: "pong", nonce });
										}),
										Match.when({ type: "rejected" }, failed),
										Match.when({ type: "entity-updated" }, (message) => {
											for (const owner of declarations.get(key) ?? []) {
												if (!isCurrent()) {
													return;
												}
												if (
													owner.interest.foreground.includes(message.entityId) ||
													owner.interest.visible.includes(message.entityId)
												) {
													try {
														owner.onUpdate({ entityId: message.entityId, reason: message.reason });
													} catch {
														/* A listener must not stop transport. */
													}
												}
											}
										}),
										Match.exhaustive,
									);
								},
								options,
							);
							return undefined;
						})
						.catch(() => {
							if (!disposed && current === attempt) {
								failed();
							}
						});
				}
				const unsubscribe = io.subscribe(connect);
				const release = () => {
					if (disposed) {
						return;
					}
					disposed = true;
					stop();
					batch?.();
					for (const removal of grace.values()) {
						removal();
					}
					grace.clear();
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
				}),
			);
			return {
				watch,
				acquire,
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
