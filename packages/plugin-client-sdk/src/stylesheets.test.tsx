import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { loadStylesheet } from "./stylesheets";

describe("lazy presentation stylesheets", () => {
	it.live("shares one link and promise between simultaneous presentations", () =>
		Effect.gen(function* () {
			const href = "/presentations/shared.css";
			const first = loadStylesheet(href);
			const second = loadStylesheet(href);
			expect(second).toBe(first);
			const links = document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`);
			expect(links).toHaveLength(1);
			links[0]?.dispatchEvent(new Event("load"));
			yield* Effect.promise(() => expect(first).resolves.toBeUndefined());
			yield* Effect.promise(() => expect(loadStylesheet(href)).resolves.toBeUndefined());
			expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
		}),
	);

	it.live("recognizes a document-warmed stylesheet without adding a link", () =>
		Effect.gen(function* () {
			const href = "/presentations/warmed.css";
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = href;
			document.head.append(link);
			const loading = loadStylesheet(href);
			expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
			link.dispatchEvent(new Event("load"));
			yield* Effect.promise(() => expect(loading).resolves.toBeUndefined());
		}),
	);

	it.live("rejects a broken stylesheet without duplicating its link", () =>
		Effect.gen(function* () {
			const href = "/presentations/broken.css";
			const loading = loadStylesheet(href);
			document.querySelector(`link[href="${href}"]`)?.dispatchEvent(new Event("error"));
			yield* Effect.promise(() =>
				expect(loading).rejects.toThrow("Client stylesheet failed to load"),
			);
			yield* Effect.promise(() =>
				expect(loadStylesheet(href)).rejects.toThrow("Client stylesheet failed to load"),
			);
			expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
		}),
	);

	it.live("rejects a warmed stylesheet whose error happened before first use", () =>
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
			yield* Effect.promise(() =>
				expect(loading).rejects.toThrow("Client stylesheet failed to load"),
			);
			expect(document.querySelectorAll(`link[rel="stylesheet"][href="${href}"]`)).toHaveLength(1);
		}),
	);
});
