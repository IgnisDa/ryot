import type { PluginListenerHandle } from "@capacitor/core";
import { describe, expect, it } from "vitest";

import { subscribeEntityInterestLifecycle, subscribeNativeResume } from "./transport";

describe("entity interest live lifecycle", () => {
	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the native listener cleanup callback.
	it("subscribes native resume and releases a late listener without later callbacks", async () => {
		let events = 0;
		let resume: (() => void) | undefined;
		let registered: ((handle: PluginListenerHandle) => void) | undefined;
		let removed = 0;
		const release = subscribeNativeResume(
			() => {
				events++;
			},
			(notify) => {
				resume = notify;
				// oxlint-disable-next-line effecttsgo/new-promise -- The native listener registration stays pending until this test releases it.
				return new Promise((resolve) => {
					registered = resolve;
				});
			},
		);

		resume?.();
		expect(events).toBe(1);
		release();
		registered?.({
			remove: () => {
				removed++;
				return Promise.resolve();
			},
		});
		await Promise.resolve();
		resume?.();
		expect(events).toBe(1);
		expect(removed).toBe(1);
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the browser and native listener cleanup callback.
	it("cleans browser listeners and late native registration, with no callbacks after release", async () => {
		let events = 0;
		let removed = 0;
		let resume: (() => void) | undefined;
		let registered: ((handle: PluginListenerHandle) => void) | undefined;
		const window = new EventTarget();
		const document = new EventTarget();
		const release = subscribeEntityInterestLifecycle(
			() => {
				events++;
			},
			{
				window,
				document,
				listenResume: (notify) => {
					resume = notify;
					// oxlint-disable-next-line effecttsgo/new-promise -- The native registration gate remains pending until the test releases it.
					return new Promise((resolve) => {
						registered = resolve;
					});
				},
			},
		);
		window.dispatchEvent(new Event("online"));
		window.dispatchEvent(new Event("offline"));
		document.dispatchEvent(new Event("visibilitychange"));
		resume?.();
		expect(events).toBe(4);
		release();
		release();
		registered?.({
			remove: () => {
				removed++;
				return Promise.resolve();
			},
		});
		await Promise.resolve();
		window.dispatchEvent(new Event("online"));
		window.dispatchEvent(new Event("offline"));
		document.dispatchEvent(new Event("visibilitychange"));
		resume?.();
		expect(events).toBe(4);
		expect(removed).toBe(1);
	});

	// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the native registration rejection callback.
	it("keeps browser lifecycle active if native listener registration fails", async () => {
		let events = 0;
		const window = new EventTarget();
		const release = subscribeEntityInterestLifecycle(
			() => {
				events++;
			},
			{
				window,
				document: new EventTarget(),
				listenResume: () => Promise.reject(new Error("native unavailable")),
			},
		);
		await Promise.resolve();
		window.dispatchEvent(new Event("online"));
		expect(events).toBe(1);
		release();
		await Promise.resolve();
	});
});
