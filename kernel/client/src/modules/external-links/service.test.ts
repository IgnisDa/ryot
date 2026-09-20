import { describe, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/client-sdk";
import { Effect } from "effect";

import { ExternalLinkPlatform, ExternalLinks } from "#/modules/external-links/service";

const recordingPlatform = (
	events: string[],
	options: {
		readonly native?: boolean;
		readonly active?: boolean;
		readonly blocked?: boolean;
		readonly failAt?: "detach" | "policy" | "replace" | "native" | "blank";
	} = {},
) => {
	const record = (event: string) => {
		events.push(event);
		if (event === options.failAt) {
			throw new Error("Platform failure");
		}
	};
	return {
		isNative: options.native ?? false,
		isActive: () => {
			events.push("activation");
			return options.active ?? true;
		},
		openNative: (url: string) =>
			Effect.suspend(() => {
				events.push("native", url);
				return options.failAt === "native"
					? Effect.fail(new RyotClientError("link-open-failed"))
					: Effect.void;
			}),
		openBlank: () => {
			record("blank");
			return options.blocked
				? null
				: {
						close: () => record("close"),
						detachOpener: () => record("detach"),
						setNoReferrer: () => record("policy"),
						replace: (url: string) => {
							record("replace");
							events.push(url);
						},
					};
		},
	};
};

const makeExternalLinks = (events: string[], options?: Parameters<typeof recordingPlatform>[1]) =>
	ExternalLinks.make.pipe(
		Effect.provideService(ExternalLinkPlatform, recordingPlatform(events, options)),
	);

describe("external links", () => {
	it.effect("opens a blank window and isolates it before navigation, without yielding", () => {
		const events: string[] = [];
		return Effect.gen(function* () {
			const service = yield* makeExternalLinks(events);
			expect(yield* service.open({ url: "https://example.test/path" })).toEqual({
				outcome: "success",
			});
			expect(events).toEqual([
				"activation",
				"blank",
				"detach",
				"policy",
				"replace",
				"https://example.test/path",
			]);
		});
	});

	it.effect("rejects invalid requests before touching either platform", () => {
		const events: string[] = [];
		return Effect.gen(function* () {
			const service = yield* makeExternalLinks(events);
			for (const url of ["/relative", "javascript:alert(1)", "file:///tmp/file"]) {
				expect(yield* service.outcome({ url })).toEqual({
					outcome: "failure",
					reason: "invalid-request",
				});
			}
			expect(events).toEqual([]);
		});
	});

	for (const options of [
		{ active: false },
		{ blocked: true },
		{ failAt: "blank" },
		{ failAt: "detach" },
		{ failAt: "policy" },
		{ failAt: "replace" },
	] as const) {
		it.effect(`classifies web launch failure ${JSON.stringify(options)}`, () => {
			const events: string[] = [];
			return Effect.gen(function* () {
				const service = yield* makeExternalLinks(events, options);
				expect(yield* service.outcome({ url: "https://example.test" })).toEqual({
					outcome: "failure",
					reason: "active" in options ? "activation-required" : "link-open-failed",
				});
				if ("active" in options) {
					expect(events).toEqual(["activation"]);
				} else if ("blocked" in options || options.failAt === "blank") {
					expect(events).toEqual(["activation", "blank"]);
				} else {
					expect(events.at(-1)).toBe("close");
					expect(events).not.toContain("https://example.test");
				}
			});
		});
	}

	for (const fail of [false, true]) {
		it.effect(
			`uses native Browser authority with no web activation check (failure: ${fail})`,
			() => {
				const events: string[] = [];
				return Effect.gen(function* () {
					const service = yield* makeExternalLinks(events, {
						native: true,
						active: false,
						...(fail ? { failAt: "native" } : {}),
					});
					expect(yield* service.outcome({ url: "http://example.test" })).toEqual(
						fail ? { outcome: "failure", reason: "link-open-failed" } : { outcome: "success" },
					);
					expect(events).toEqual(["native", "http://example.test"]);
				});
			},
		);
	}
});
