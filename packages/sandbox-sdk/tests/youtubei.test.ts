import { Effect } from "@ryot-app/sandbox-sdk/effect";
import {
	createYoutubeHistoryClient,
	createYoutubeMusicClient,
	type YoutubeiHost,
} from "@ryot-app/sandbox-sdk/youtubei";
import { describe, expect, test } from "vitest";

const runtimeKey = Symbol.for("@ryot-app/sandbox-sdk/approved-dependency-runtime");

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
	test("requests YouTube Music history", async () => {
		const requests: { body: string | undefined; url: string }[] = [];
		const host = {
			httpCall: (_method, url, options) =>
				Effect.sync(() => {
					requests.push({ url, body: options?.body });
					return {
						status: 200,
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ contents: { history: true } }),
					};
				}),
		} satisfies YoutubeiHost;
		const client = await Effect.runPromise(createYoutubeHistoryClient(host, "SAPISID=value"));

		await client.getHistory();

		expect(requests).toHaveLength(1);
		expect(new URL(requests[0]?.url ?? "").pathname).toBe("/youtubei/v1/browse");
		expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
			params: "oggECgIIAQ%3D%3D",
			browseId: "FEmusic_history",
		});
	});

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
		} satisfies YoutubeiHost;
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
