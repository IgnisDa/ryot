import {
	PLUGIN_CATALOG_CONNECTED_EVENT,
	PLUGIN_CATALOG_INVALIDATED_EVENT,
} from "@ryot/contract/modules/plugins/contract";
import { Effect, Fiber, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import type { ApiScope } from "#/api/scope";
import { makePluginCatalogEventsLayer, PluginCatalogEventsService } from "#/modules/plugins/events";

const scope: ApiScope = {
	userId: "user-1",
	serverUrl: "https://ryot.example/root/",
};

class TestEventSource {
	closed = false;
	readonly listeners = new Map<string, Set<() => void>>();

	constructor(
		readonly url: string,
		readonly options: EventSourceInit,
	) {}

	addEventListener(type: string, listener: () => void) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	close() {
		this.closed = true;
	}

	send(type: string) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener();
		}
	}
}

const makeRuntime = () => {
	const sources: TestEventSource[] = [];
	let markOpened: (() => void) | undefined;
	const opened = new Promise<void>((resolve) => {
		markOpened = () => resolve();
	});
	const runtime = ManagedRuntime.make(
		makePluginCatalogEventsLayer((url, options) => {
			const source = new TestEventSource(url, options);
			sources.push(source);
			markOpened?.();
			return source;
		}),
	);
	return { opened, runtime, sources };
};

describe("plugin catalog events service", () => {
	it("opens the canonical authenticated endpoint and routes catalog events", async () => {
		const { opened, runtime, sources } = makeRuntime();
		let refreshes = 0;
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => {
					refreshes += 1;
				}),
			),
		);

		try {
			await opened;
			expect(sources[0]?.url).toBe("https://ryot.example/root/api/plugins/events");
			expect(sources[0]?.options).toEqual({ withCredentials: true });

			sources[0]?.send(PLUGIN_CATALOG_CONNECTED_EVENT);
			sources[0]?.send(PLUGIN_CATALOG_INVALIDATED_EVENT);
			expect(refreshes).toBe(2);
		} finally {
			await Effect.runPromise(Fiber.interrupt(subscription));
			await runtime.dispose();
		}
	});

	it("leaves reconnects to the browser and closes the source on interruption", async () => {
		const { opened, runtime, sources } = makeRuntime();
		const subscription = runtime.runFork(
			Effect.flatMap(PluginCatalogEventsService, (service) =>
				service.subscribe(scope, () => undefined),
			),
		);

		await opened;
		sources[0]?.send("error");
		expect(sources).toHaveLength(1);

		await Effect.runPromise(Fiber.interrupt(subscription));
		expect(sources[0]?.closed).toBe(true);
		await runtime.dispose();
	});
});
