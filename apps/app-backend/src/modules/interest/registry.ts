import type { ServerWebSocket } from "bun";
import { Effect, Either } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { decodeEntityUpdatedMessage, redisKeys, RedisService } from "#lib/redis";

import { encodeServerMessage, type ServerMessage } from "./messages";

// Session identity is captured once at upgrade and never re-validated per message.
export type WsData = { readonly user: CurrentUserValue };
export type InterestSocket = ServerWebSocket<WsData>;

const send = (ws: InterestSocket, message: ServerMessage): void => {
	try {
		ws.send(encodeServerMessage(message));
	} catch {
		// Socket already closed between selection and send; the close handler cleans it up.
	}
};

// Per-process registry of which sockets want which entities, plus the single duplicated Redis
// subscriber that fans `entity:updated` out to the local sockets that declared interest.
export class WsRegistry extends Effect.Service<WsRegistry>()("WsRegistry", {
	scoped: Effect.gen(function* () {
		const redis = yield* RedisService;
		const channel = redisKeys.entityUpdatedChannel;

		// Forward: entity id → interested sockets (used by the fan-out). Reverse: socket → its declared
		// set (used to diff on replace and to clean up on close). Kept in lock-step.
		const byEntity = new Map<string, Set<InterestSocket>>();
		const bySocket = new Map<InterestSocket, Set<string>>();

		// Diff against the socket's prior set so only real changes touch the forward index.
		const setInterest = (ws: InterestSocket, entityIds: readonly string[]): void => {
			const next = new Set(entityIds);
			const prev = bySocket.get(ws) ?? new Set<string>();
			for (const id of prev) {
				if (!next.has(id)) {
					const sockets = byEntity.get(id);
					sockets?.delete(ws);
					if (sockets?.size === 0) {
						byEntity.delete(id);
					}
				}
			}
			for (const id of next) {
				if (!prev.has(id)) {
					const sockets = byEntity.get(id) ?? new Set<InterestSocket>();
					sockets.add(ws);
					byEntity.set(id, sockets);
				}
			}
			bySocket.set(ws, next);
		};

		const hasInterest = (ws: InterestSocket, entityId: string): boolean =>
			bySocket.get(ws)?.has(entityId) ?? false;

		const remove = (ws: InterestSocket): void => {
			const ids = bySocket.get(ws);
			if (ids) {
				for (const id of ids) {
					const sockets = byEntity.get(id);
					sockets?.delete(ws);
					if (sockets?.size === 0) {
						byEntity.delete(id);
					}
				}
			}
			bySocket.delete(ws);
		};

		const fanOut = (raw: string): void => {
			const decoded = decodeEntityUpdatedMessage(raw);
			if (Either.isLeft(decoded)) {
				return;
			}
			const { entityId, reason } = decoded.right;
			const sockets = byEntity.get(entityId);
			if (!sockets) {
				return;
			}
			for (const ws of sockets) {
				send(ws, { type: "entity:updated", entityId, reason });
			}
		};

		const subscriber = redis.client.duplicate();
		subscriber.on("message", (incoming, message) => {
			if (incoming === channel) {
				fanOut(message);
			}
		});
		// ioredis restores subscriptions on reconnect, but re-subscribing on `ready` is idempotent and
		// guards against any gap.
		subscriber.on("ready", () => {
			void subscriber.subscribe(channel).catch(() => undefined);
		});
		yield* Effect.tryPromise(() => subscriber.subscribe(channel)).pipe(Effect.orDie);

		const teardown = Effect.sync(() => {
			subscriber.removeAllListeners();
			for (const ws of bySocket.keys()) {
				try {
					ws.close();
				} catch {
					// Best-effort close during teardown; the socket may already be gone.
				}
			}
			byEntity.clear();
			bySocket.clear();
		});
		yield* Effect.addFinalizer(() =>
			teardown.pipe(
				Effect.zipRight(Effect.tryPromise(() => subscriber.quit()).pipe(Effect.ignore)),
			),
		);

		return { send, remove, setInterest, hasInterest };
	}),
}) {}
