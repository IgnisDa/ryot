import type { EntityUpdate } from "@ryot-app/client-sdk";
import { act, render } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createElement, StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { makeEntityInterestApi } from "#/api/ports.test-layer";

import { EntityInterestService } from "./service";
import { EntityInterestTransport, type InterestSocket } from "./transport";

const updates: EntityUpdate[] = [];
const empty = { foreground: [], visible: [] };
const cleanups: Array<() => Promise<void>> = [];
const scope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

afterEach(async () => {
	updates.length = 0;
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

class RecordingSocket extends EventTarget implements InterestSocket {
	closed = false;
	readonly sent: unknown[] = [];
	messageListener: EventListener | undefined;
	override addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean,
	) {
		if (type === "message" && typeof listener === "function") {
			this.messageListener = listener;
		}
		super.addEventListener(type, listener, options);
	}
	close() {
		this.closed = true;
	}
	send(frame: string) {
		this.sent.push(JSON.parse(frame));
	}
	frame(message: unknown) {
		this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
	}
	ready() {
		this.dispatchEvent(new Event("open"));
		this.frame({
			type: "ready",
			maxEntityIds: 500,
			sessionId: "session",
			heartbeatIntervalMs: 25_000,
		});
	}
}

const settle = async () => {
	for (let i = 0; i < 20; i++) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Drain successive ticket microtasks.
		await Promise.resolve();
	}
};

function setup(options: { readonly pendingTicket?: boolean } = {}) {
	let now = 0;
	let tickets = 0;
	let available = true;
	let changed: (() => void) | undefined;
	const urls: string[] = [];
	const overflows: number[] = [];
	const sockets: RecordingSocket[] = [];
	const timers = new Set<{ at: number; callback: () => void }>();
	const runtime = ManagedRuntime.make(
		EntityInterestService.layer.pipe(
			Layer.provide(
				makeEntityInterestApi({
					createSocketTicket: () =>
						options.pendingTicket
							? Effect.never
							: Effect.sync(() => ({
									ticket: `ticket-${++tickets}`,
									expiresAt: "2026-09-05T12:00:00Z",
								})),
				}),
			),
			Layer.provide(
				Layer.succeed(EntityInterestTransport, {
					available: () => available,
					reportOverflow: (count) => {
						overflows.push(count);
					},
					subscribe: (listener) => {
						changed = listener;
						return () => {
							changed = undefined;
						};
					},
					open: (url) => {
						urls.push(url);
						const socket = new RecordingSocket();
						sockets.push(socket);
						return socket;
					},
					schedule: (delay, callback) => {
						const timer = { at: now + delay, callback };
						timers.add(timer);
						return () => {
							timers.delete(timer);
						};
					},
				}),
			),
		),
	);
	cleanups.push(() => runtime.dispose());
	const service = runtime.runSync(EntityInterestService);
	const advance = (duration: number) => {
		const end = now + duration;
		for (;;) {
			const next = [...timers]
				.filter((timer) => timer.at <= end)
				.sort((a, b) => a.at - b.at)
				.at(0);
			if (!next) {
				break;
			}
			now = next.at;
			timers.delete(next);
			next.callback();
		}
		now = end;
	};
	return {
		urls,
		timers,
		runtime,
		service,
		sockets,
		advance,
		overflows,
		tickets: () => tickets,
		hasListener: () => changed !== undefined,
		lifecycle: (next = true) => {
			available = next;
			changed?.();
		},
		socket: () => {
			const socket = sockets.at(-1);
			if (!socket) {
				throw new Error("No socket");
			}
			return socket;
		},
	};
}

describe("entity interest session", () => {
	it("disposes an in-flight ticket even while multiple layout leases remain", async () => {
		const test = setup({ pendingTicket: true });
		const firstRelease = test.service.acquire(scope);
		const secondRelease = test.service.acquire({ ...scope });
		await test.runtime.dispose();
		firstRelease();
		secondRelease();
		test.lifecycle();
		test.advance(60_000);
		await settle();
		expect(test.sockets).toEqual([]);
		expect(test.timers.size).toBe(0);
		expect(test.hasListener()).toBe(false);
	});

	it("retains same-scope acquisitions without dropping newly declared owners or opening another socket", async () => {
		const test = setup();
		const firstRelease = test.service.acquire(scope);
		await settle();
		const socket = test.socket();
		socket.ready();
		socket.frame({ type: "applied", revision: 1 });
		const owner = test.service.watch({ ...scope }, { foreground: ["new"], visible: [] }, (update) =>
			updates.push(update),
		);
		const secondRelease = test.service.acquire({ ...scope });
		test.advance(100);
		await settle();
		expect(test.sockets).toHaveLength(1);
		expect(test.tickets()).toBe(1);
		expect(socket.sent.at(-1)).toEqual({ type: "update", revision: 2, add: ["new"], remove: [] });
		firstRelease();
		firstRelease();
		expect(socket.closed).toBe(false);
		socket.frame({ type: "entity-updated", entityId: "new", reason: "translated" });
		secondRelease();
		expect(socket.closed).toBe(true);
		expect(test.timers.size).toBe(0);
		expect(test.hasListener()).toBe(false);
		owner.update({ foreground: ["new"], visible: [] });
		test.service.acquire(scope);
		await settle();
		test.socket().ready();
		test.socket().frame({ type: "entity-updated", entityId: "new", reason: "populated" });
		expect(test.socket().sent.at(-1)).toEqual({ type: "replace", revision: 1, entityIds: [] });
		expect(updates).toEqual([{ entityId: "new", reason: "translated" }]);
	});

	it("preserves child declarations after StrictMode replay, navigation, revalidation and browser resume", async () => {
		const test = setup();
		const events: string[] = [];
		function Child(props: { id: string }) {
			useEffect(() => {
				events.push(`watch:${props.id}`);
				const owner = test.service.watch(
					{ ...scope },
					{ foreground: [props.id], visible: [] },
					(update) => updates.push(update),
				);
				return () => owner.dispose();
			}, [props.id]);
			return null;
		}
		function Layout(props: { id: string; scope: typeof scope }) {
			const { userId, serverUrl } = props.scope;
			useEffect(() => {
				events.push("acquire");
				return test.service.acquire({ userId, serverUrl });
			}, [userId, serverUrl]);
			return createElement(Child, { id: props.id });
		}
		const tree = (id: string) =>
			createElement(StrictMode, null, createElement(Layout, { id, scope: { ...scope } }));
		const view = render(tree("a"));
		await act(settle);
		expect(events).toEqual(["watch:a", "acquire", "watch:a", "acquire"]);
		const first = test.socket();
		first.ready();
		expect(first.sent.at(-1)).toEqual({ type: "replace", revision: 1, entityIds: ["a"] });
		first.frame({ type: "entity-updated", entityId: "a", reason: "populated" });
		view.rerender(tree("b"));
		view.rerender(tree("b"));
		await act(settle);
		expect(events).toEqual(["watch:a", "acquire", "watch:a", "acquire", "watch:b"]);
		expect(test.socket()).toBe(first);
		test.lifecycle(false);
		test.advance(2000);
		test.lifecycle();
		await act(settle);
		const resumed = test.socket();
		resumed.ready();
		expect(resumed.sent.at(-1)).toEqual({ type: "replace", revision: 1, entityIds: ["b"] });
		resumed.frame({ type: "entity-updated", entityId: "a", reason: "translated" });
		resumed.frame({ type: "entity-updated", entityId: "b", reason: "translated" });
		view.unmount();
		resumed.frame({ type: "entity-updated", entityId: "b", reason: "populated" });
		expect(updates).toEqual([
			{ entityId: "a", reason: "populated" },
			{ entityId: "b", reason: "translated" },
		]);
		expect(resumed.closed).toBe(true);
		expect(test.timers.size).toBe(0);
		expect(test.hasListener()).toBe(false);
	});

	it("reports deduplicated omitted count only once per layout session despite declaration churn and reconnects", async () => {
		const test = setup();
		const ids = Array.from({ length: 502 }, (_, i) => `id-${i}`);
		const owner = test.service.watch(scope, { foreground: ["id-0"], visible: ids }, () => {});
		const release = test.service.acquire(scope);
		expect(test.overflows).toEqual([2]);
		for (let i = 0; i < 100; i++) {
			owner.update({ foreground: [], visible: ids.slice(0, 500 + (i % 3)) });
		}
		test.lifecycle(false);
		test.lifecycle();
		await settle();
		expect(test.overflows).toEqual([2]);
		release();
		test.service.watch(scope, { foreground: [], visible: ids.slice(1) }, () => {});
		test.service.acquire(scope);
		expect(test.overflows).toEqual([2, 1]);
	});

	it("retains predeclared next-scope owners while invalidating the previous scope", async () => {
		const test = setup();
		let oldUpdates = 0;
		const nextScope = { ...scope, userId: "user-2" };
		test.service.watch(scope, { foreground: ["a"], visible: [] }, () => {
			oldUpdates++;
		});
		const release = test.service.acquire(scope);
		await settle();
		const oldSocket = test.socket();
		oldSocket.ready();
		test.service.watch(nextScope, { foreground: [], visible: ["b"] }, (update) =>
			updates.push(update),
		);
		test.service.acquire({ ...nextScope });
		release();
		await settle();
		const socket = test.socket();
		socket.ready();
		expect(oldSocket.closed).toBe(true);
		expect(socket.closed).toBe(false);
		expect(socket.sent.at(-1)).toEqual({ type: "replace", revision: 1, entityIds: ["b"] });
		socket.frame({ type: "entity-updated", entityId: "b", reason: "translated" });
		socket.frame({ type: "entity-updated", entityId: "a", reason: "populated" });
		expect(oldUpdates).toBe(0);
		expect(updates).toEqual([{ entityId: "b", reason: "translated" }]);
		await test.runtime.dispose();
		expect(socket.closed).toBe(true);
		expect(test.timers.size).toBe(0);
		expect(test.hasListener()).toBe(false);
	});

	it("isolates listener exceptions and stops disposed owners immediately", async () => {
		const test = setup();
		test.service.watch(scope, { foreground: ["a"], visible: [] }, () => {
			throw new Error("Listener failed");
		});
		const owner = test.service.watch(scope, { foreground: [], visible: ["a"] }, (update) =>
			updates.push(update),
		);
		test.service.acquire(scope);
		await settle();
		const socket = test.socket();
		socket.ready();
		socket.frame({ type: "entity-updated", entityId: "a", reason: "populated" });
		owner.dispose();
		owner.dispose();
		owner.update({ foreground: ["a"], visible: [] });
		socket.frame({ type: "entity-updated", entityId: "a", reason: "translated" });
		expect(updates).toEqual([{ entityId: "a", reason: "populated" }]);
		expect(socket.closed).toBe(false);
	});

	it("holds declarations before layout mount, authenticates first and deduplicates foreground before visible", async () => {
		const test = setup();
		const visible = Array.from({ length: 501 }, (_, i) => `visible-${String(i).padStart(3, "0")}`);
		test.service.watch(scope, { foreground: ["foreground"], visible }, (update) =>
			updates.push(update),
		);
		test.service.watch({ ...scope }, { foreground: ["foreground"], visible: [] }, () => {});
		expect(test.tickets()).toBe(0);
		test.service.acquire({ ...scope });
		await settle();
		expect(test.urls).toEqual(["wss://ryot.example/api/entity-interest/ws"]);
		test.socket().ready();
		expect(test.socket().sent).toEqual([
			{ type: "authenticate", ticket: "ticket-1" },
			{ type: "replace", revision: 1, entityIds: ["foreground", ...visible.slice(0, 499)] },
		]);
	});

	it("batches additions, serializes acknowledgements, and removes only after grace", async () => {
		const test = setup();
		const owner = test.service.watch(scope, { foreground: ["a"], visible: [] }, () => {});
		test.service.acquire(scope);
		await settle();
		const socket = test.socket();
		socket.ready();
		owner.update({ foreground: ["a", "b"], visible: [] });
		test.advance(100);
		expect(socket.sent).toHaveLength(2);
		socket.frame({ type: "applied", revision: 1 });
		expect(socket.sent.at(-1)).toEqual({ type: "update", revision: 2, add: ["b"], remove: [] });
		owner.update({ foreground: ["b", "c"], visible: [] });
		test.advance(99);
		socket.frame({ type: "applied", revision: 2 });
		expect(socket.sent).toHaveLength(3);
		test.advance(1);
		expect(socket.sent.at(-1)).toEqual({ type: "update", revision: 3, add: ["c"], remove: [] });
		socket.frame({ type: "applied", revision: 3 });
		test.advance(1899);
		expect(socket.sent).toHaveLength(4);
		test.advance(1);
		expect(socket.sent.at(-1)).toEqual({ type: "update", revision: 4, add: [], remove: ["a"] });
	});

	it("evicts grace entries for new demand and cancels removal when demand returns", async () => {
		const test = setup();
		const ids = Array.from({ length: 500 }, (_, i) => `id-${i}`);
		const owner = test.service.watch(scope, { foreground: [], visible: ids }, () => {});
		test.service.acquire(scope);
		await settle();
		const socket = test.socket();
		socket.ready();
		socket.frame({ type: "applied", revision: 1 });
		owner.update({ foreground: ["new"], visible: ids.slice(1) });
		test.advance(100);
		expect(socket.sent.at(-1)).toEqual({
			revision: 2,
			add: ["new"],
			type: "update",
			remove: ["id-0"],
		});
		socket.frame({ type: "applied", revision: 2 });
		owner.update(empty);
		test.advance(1000);
		owner.update({ foreground: ["new"], visible: ids.slice(1) });
		test.advance(2000);
		expect(socket.sent).toHaveLength(3);
	});

	it("routes only current memberships and invalidates old owners and socket callbacks on release", async () => {
		const test = setup();
		const owner = test.service.watch(scope, { foreground: ["a"], visible: [] }, (update) =>
			updates.push(update),
		);
		const release = test.service.acquire(scope);
		await settle();
		const socket = test.socket();
		socket.ready();
		const stale = socket.messageListener;
		socket.frame({ type: "entity-updated", entityId: "other", reason: "translated" });
		socket.frame({ type: "entity-updated", entityId: "a", reason: "populated" });
		owner.update({ foreground: [], visible: ["b"] });
		socket.frame({ type: "entity-updated", entityId: "a", reason: "translated" });
		socket.frame({ type: "entity-updated", entityId: "b", reason: "translated" });
		release();
		release();
		expect(test.timers.size).toBe(0);
		expect(test.hasListener()).toBe(false);
		owner.update({ foreground: ["a"], visible: [] });
		test.service.acquire(scope);
		await settle();
		test.socket().ready();
		stale?.(
			new MessageEvent("message", {
				data: JSON.stringify({ type: "entity-updated", entityId: "a", reason: "populated" }),
			}),
		);
		expect(test.socket().sent.at(-1)).toEqual({ type: "replace", revision: 1, entityIds: [] });
		expect(updates).toEqual([
			{ entityId: "a", reason: "populated" },
			{ entityId: "b", reason: "translated" },
		]);
	});

	it("gets a fresh ticket and replaces revision one after lease closure or lifecycle resume", async () => {
		const test = setup();
		test.service.watch(scope, { foreground: ["a"], visible: [] }, () => {});
		test.service.acquire(scope);
		await settle();
		const first = test.socket();
		first.ready();
		first.dispatchEvent(new CloseEvent("close", { code: 4001 }));
		test.advance(999);
		await settle();
		expect(test.sockets).toHaveLength(1);
		test.advance(1);
		await settle();
		test.socket().ready();
		expect(test.socket().sent).toEqual([
			{ type: "authenticate", ticket: "ticket-2" },
			{ type: "replace", revision: 1, entityIds: ["a"] },
		]);
		test.lifecycle(false);
		expect(test.socket().closed).toBe(true);
		test.advance(60_000);
		await settle();
		expect(test.sockets).toHaveLength(2);
		test.lifecycle();
		await settle();
		expect(test.tickets()).toBe(3);
		test.service.reconnect({ ...scope, userId: "other" });
		await settle();
		expect(test.tickets()).toBe(3);
		test.service.reconnect({ ...scope });
		await settle();
		expect(test.tickets()).toBe(4);
	});

	it.each([
		{ type: "applied", revision: 5 },
		{ type: "ready", sessionId: "duplicate", maxEntityIds: 500, heartbeatIntervalMs: 25_000 },
		{ type: "entity-updated", entityId: "a", reason: "invalid" },
		{ type: "rejected", revision: 1, maxEntityIds: 500, code: "interest-limit-exceeded" },
	])("reconnects on malformed or out-of-order frames: $type", async (frame) => {
		const test = setup();
		test.service.acquire(scope);
		await settle();
		const socket = test.socket();
		socket.ready();
		socket.frame(frame);
		expect(socket.closed).toBe(true);
		test.advance(1000);
		await settle();
		expect(test.tickets()).toBe(2);
	});

	it("times out tickets and handshakes, caps backoff, and answers heartbeats", async () => {
		const test = setup();
		test.service.acquire(scope);
		await settle();
		for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
			const count = test.tickets();
			test.advance(15_000);
			expect(test.socket().closed).toBe(true);
			test.advance(delay - 1);
			// oxlint-disable-next-line eslint/no-await-in-loop -- Observe each retry before advancing its next deadline.
			await settle();
			expect(test.tickets()).toBe(count);
			test.advance(1);
			// oxlint-disable-next-line eslint/no-await-in-loop -- Complete this ticket before the next retry.
			await settle();
			expect(test.tickets()).toBe(count + 1);
		}
		const socket = test.socket();
		socket.ready();
		test.advance(25_000);
		socket.frame({ type: "ping", nonce: "nonce" });
		expect(socket.sent.at(-1)).toEqual({ type: "pong", nonce: "nonce" });
		test.advance(74_999);
		expect(socket.closed).toBe(false);
		test.advance(1);
		expect(socket.closed).toBe(true);
		const pending = setup({ pendingTicket: true });
		const release = pending.service.acquire(scope);
		pending.advance(15_000);
		expect(pending.sockets).toHaveLength(0);
		release();
		expect(pending.timers.size).toBe(0);
	});
});
