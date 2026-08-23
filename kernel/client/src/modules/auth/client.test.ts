import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import {
	AuthClient,
	BETTER_AUTH_STORAGE_KEYS,
	makeAuthSessionStore,
	settleSession,
	type AuthSessionSnapshot,
	type AuthSessionSource,
	type AuthSessionStore,
} from "#/modules/auth/client";
import { clientStorageLayer, sessionTokenKey, type BrowserStorage } from "#/persistence/storage";

const makeStorage = (entries: readonly (readonly [string, string])[]) => {
	const values = new Map(entries);
	const storage: BrowserStorage = {
		removeItem: (key) => values.delete(key),
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
	return { storage, values };
};

describe("browser auth client", () => {
	it("adapts session changes into stable snapshots and releases subscriptions", () => {
		let state: ReturnType<AuthSessionSource["get"]> = { data: null, isPending: true };
		const listeners = new Set<() => void>();
		const store = makeAuthSessionStore({
			get: () => state,
			listen: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		});
		const initial = store.getSnapshot();
		let notifications = 0;
		const unsubscribe = store.subscribe(() => {
			notifications += 1;
		});

		expect(store.getSnapshot()).toBe(initial);
		state = {
			isPending: false,
			data: {
				user: {
					id: "user-1",
					name: "Test User",
					email: "user@example.com",
					image: "https://example.com/avatar.png",
				},
			},
		};
		listeners.forEach((listener) => listener());
		expect(notifications).toBe(1);
		expect(store.getSnapshot()).toEqual({
			status: "authenticated",
			user: {
				id: "user-1",
				name: "Test User",
				email: "user@example.com",
				image: "https://example.com/avatar.png",
			},
		});

		unsubscribe();
		listeners.forEach((listener) => listener());
		expect(notifications).toBe(1);
	});

	it("settles immediately from an already-settled snapshot without subscribing", async () => {
		let subscribeCalls = 0;
		const store: AuthSessionStore = {
			getSnapshot: () => ({ status: "missing" }),
			subscribe: () => {
				subscribeCalls += 1;
				return () => undefined;
			},
		};

		const result = await Effect.runPromise(settleSession(store));

		expect(result).toEqual({ status: "missing" });
		expect(subscribeCalls).toBe(0);
	});

	it("subscribes and resolves once a pending snapshot settles, then unsubscribes", async () => {
		let state: AuthSessionSnapshot = { status: "pending" };
		let unsubscribed = false;
		const listeners = new Set<() => void>();
		const store: AuthSessionStore = {
			getSnapshot: () => state,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
					unsubscribed = true;
				};
			},
		};

		const settled = Effect.runPromise(settleSession(store));
		expect(listeners.size).toBe(1);
		expect(unsubscribed).toBe(false);

		state = { status: "missing" };
		listeners.forEach((listener) => listener());

		expect(await settled).toEqual({ status: "missing" });
		expect(unsubscribed).toBe(true);
	});

	it("unsubscribes when interrupted before the session settles", async () => {
		let unsubscribed = false;
		const store: AuthSessionStore = {
			getSnapshot: () => ({ status: "pending" }),
			subscribe: () => () => {
				unsubscribed = true;
			},
		};

		const fiber = Effect.runFork(settleSession(store));
		await Effect.runPromise(Fiber.interrupt(fiber));

		expect(unsubscribed).toBe(true);
	});

	it.effect("caches session stores by normalized server origin", () => {
		const { storage } = makeStorage([]);
		return Effect.gen(function* () {
			const client = yield* AuthClient;
			const first = client.session(" https://one.test/// ");

			expect(client.session("https://one.test")).toBe(first);
			expect(client.session("https://two.test")).not.toBe(first);
		}).pipe(Effect.provide(AuthClient.layer), Effect.provide(clientStorageLayer(storage)));
	});

	it.effect("clears Better Auth storage and session tokens, and resets cached stores", () => {
		const { storage, values } = makeStorage([
			["unrelated", "keep"],
			["ryot:theme", "dark"],
			["ryot:other-setting", "keep"],
			[BETTER_AUTH_STORAGE_KEYS[0], "session-event"],
			[sessionTokenKey("https://one.test"), "token-one"],
			[sessionTokenKey("https://other.test"), "token-other"],
		]);

		return Effect.gen(function* () {
			const client = yield* AuthClient;
			const first = client.session("https://one.test");
			yield* client.clear();

			expect(Object.fromEntries(values)).toEqual({
				unrelated: "keep",
				"ryot:theme": "dark",
				"ryot:other-setting": "keep",
				[sessionTokenKey("https://other.test")]: "token-other",
			});
			expect(client.session("https://one.test")).not.toBe(first);
		}).pipe(Effect.provide(AuthClient.layer), Effect.provide(clientStorageLayer(storage)));
	});
});
