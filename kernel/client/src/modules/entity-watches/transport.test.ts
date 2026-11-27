import { describe, expect } from "bun:test";

import type { PluginListenerHandle } from "@capacitor/core";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import {
	NativeResumeListenerError,
	subscribeEntityWatchLifecycle,
	subscribeNativeResume,
} from "./transport";

describe("entity interest live lifecycle", () => {
	it.live(
		"subscribes native resume and releases a late listener without later callbacks",
		() =>
			Effect.gen(function* () {
				let events = 0;
				let resume: undefined | (() => void);
				let registered: undefined | ((handle: PluginListenerHandle) => void);
				let removed = 0;
				const release = subscribeNativeResume(
					() => {
						events++;
					},
					(notify) => {
						resume = notify;
						return Effect.callback<PluginListenerHandle>((resolve) => {
							registered = (handle) => resolve(Effect.succeed(handle));
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
				yield* Effect.promise(() => Promise.resolve());
				resume?.();
				expect(events).toBe(1);
				expect(removed).toBe(1);
			}),
		testTimeout,
	);

	it.live(
		"cleans browser listeners and late native registration, with no callbacks after release",
		() =>
			Effect.gen(function* () {
				let events = 0;
				let removed = 0;
				let resume: undefined | (() => void);
				let registered: undefined | ((handle: PluginListenerHandle) => void);
				const window = new EventTarget();
				const document = new EventTarget();
				const release = subscribeEntityWatchLifecycle(
					() => {
						events++;
					},
					{
						window,
						document,
						listenResume: (notify) => {
							resume = notify;
							return Effect.callback<PluginListenerHandle>((resolve) => {
								registered = (handle) => resolve(Effect.succeed(handle));
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
				yield* Effect.promise(() => Promise.resolve());
				window.dispatchEvent(new Event("online"));
				window.dispatchEvent(new Event("offline"));
				document.dispatchEvent(new Event("visibilitychange"));
				resume?.();
				expect(events).toBe(4);
				expect(removed).toBe(1);
			}),
		testTimeout,
	);

	it.live(
		"keeps browser lifecycle active if native listener registration fails",
		() =>
			Effect.gen(function* () {
				let events = 0;
				const window = new EventTarget();
				const release = subscribeEntityWatchLifecycle(
					() => {
						events++;
					},
					{
						window,
						document: new EventTarget(),
						listenResume: () =>
							Effect.fail(
								new NativeResumeListenerError({ cause: new Error("native unavailable") }),
							),
					},
				);
				yield* Effect.promise(() => Promise.resolve());
				window.dispatchEvent(new Event("online"));
				expect(events).toBe(1);
				release();
				yield* Effect.promise(() => Promise.resolve());
			}),
		testTimeout,
	);
});
