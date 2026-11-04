import { describe, expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { loadStylesheet } from "./stylesheets";

describe("lazy presentation stylesheets", () => {
	it.live(
		"shares one link and promise between simultaneous presentations",
		() =>
			Effect.gen(function* () {
				const href = "/presentations/shared.css";
				const first = loadStylesheet(href);
				const second = loadStylesheet(href);
				expect(second).toBe(first);
				const links = document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`);
				expect(links).toHaveLength(1);
				links[0]?.dispatchEvent(new Event("load"));
				yield* Effect.map(
					Effect.promise(() => first),
					(value) => expect(value).toBeUndefined(),
				);
				yield* Effect.map(
					Effect.promise(() => loadStylesheet(href)),
					(value) => expect(value).toBeUndefined(),
				);
				expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
			}),
		testTimeout,
	);

	it.live(
		"recognizes a document-warmed stylesheet without adding a link",
		() =>
			Effect.gen(function* () {
				const href = "/presentations/warmed.css";
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = href;
				document.head.append(link);
				const loading = loadStylesheet(href);
				expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
				link.dispatchEvent(new Event("load"));
				yield* Effect.map(
					Effect.promise(() => loading),
					(value) => expect(value).toBeUndefined(),
				);
			}),
		testTimeout,
	);

	it.live(
		"removes a broken stylesheet so the section can retry it",
		() =>
			Effect.gen(function* () {
				const href = "/presentations/broken.css";
				const loading = loadStylesheet(href);
				document.querySelector(`link[href="${href}"]`)?.dispatchEvent(new Event("error"));
				yield* Effect.map(
					Effect.tryPromise(() => loading).pipe(Effect.flip),
					({ cause: error }) => {
						assert(error instanceof Error);
						expect(error.message).toContain("Client stylesheet failed to load");
					},
				);
				expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(0);
				const retry = loadStylesheet(href);
				document.querySelector(`link[href="${href}"]`)?.dispatchEvent(new Event("load"));
				yield* Effect.map(
					Effect.promise(() => retry),
					(value) => expect(value).toBeUndefined(),
				);
				expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
			}),
		testTimeout,
	);

	it.live(
		"rejects a warmed stylesheet whose error happened before first use",
		() =>
			Effect.gen(function* () {
				const href = "/presentations/warmed-error.css";
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = href;
				document.head.append(link);
				link.dispatchEvent(new Event("error"));
				const loading = loadStylesheet(href);
				if (document.readyState !== "complete") {
					window.dispatchEvent(new Event("load"));
				}
				yield* Effect.map(
					Effect.tryPromise(() => loading).pipe(Effect.flip),
					({ cause: error }) => {
						assert(error instanceof Error);
						expect(error.message).toContain("Client stylesheet failed to load");
					},
				);
				expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(0);
			}),
		testTimeout,
	);
});
