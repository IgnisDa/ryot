import { Effect } from "@ryot/sandbox-sdk/effect";
import { createYoutubeMusicClient, type YoutubeiHost } from "@ryot/sandbox-sdk/youtubei";
import { describe, expect, test } from "vitest";

const runtimeKey = Symbol.for("@ryot/sandbox-sdk/approved-dependency-runtime");

const withRuntime = (operation: () => Promise<unknown>, calls: { count: number }) => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, runtimeKey);
	Object.defineProperty(globalThis, runtimeKey, {
		configurable: true,
		value: async (callback: () => Promise<unknown>) => {
			calls.count += 1;
			return callback();
		},
	});
	return Effect.tryPromise(operation).pipe(
		Effect.ensuring(
			Effect.sync(() => {
				if (previous) {
					Object.defineProperty(globalThis, runtimeKey, previous);
				} else {
					Reflect.deleteProperty(globalThis, runtimeKey);
				}
			}),
		),
	);
};

describe("Youtubei sandbox adapter", () => {
	test("keeps the dependency runtime scope private to SDK calls", async () => {
		const calls = { count: 0 };
		const host = {
			httpCall: () => Effect.fail({ message: "unexpected network call" }),
		} as YoutubeiHost;

		const client = await Effect.runPromise(
			withRuntime(
				() =>
					Effect.runPromise(
						createYoutubeMusicClient(host, undefined, {
							retrievePlayer: false,
							retrieveInnertubeConfig: false,
						}),
					),
				calls,
			),
		);

		expect(client).toBeTruthy();
		expect(calls.count).toBe(1);
	});

	test("does not turn a pending host failure into an HTTP response", async () => {
		const pending = Symbol("pending");
		const host = {
			httpCall: () => Effect.fail(pending),
		} as unknown as YoutubeiHost;
		const client = await Effect.runPromise(
			createYoutubeMusicClient(host, undefined, {
				retrievePlayer: false,
				retrieveInnertubeConfig: false,
			}),
		);

		await expect(
			Effect.runPromise(Effect.tryPromise(() => client.actions.execute("/pending", { value: 1 }))),
		).rejects.toMatchObject({ cause: pending });
	});
});
