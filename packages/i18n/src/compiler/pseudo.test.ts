import { describe, expect, it } from "bun:test";

import { Result } from "effect";

import { emptyCatalogRegistry, registerCatalog } from "../catalog";
import { format } from "../format";
import { compileMessage } from "./parse";
import { pseudoLocalizeCatalog } from "./pseudo";

describe("pseudo-locale", () => {
	it("accents, lengthens and brackets literal text while keeping arguments", () => {
		const source = {
			"message.unavailable": Result.getOrThrow(compileMessage("Gone")),
			"item.count": Result.getOrThrow(
				compileMessage("{count, plural, one {# item for {name}} other {# items}}"),
			),
		};
		const registry = registerCatalog(
			registerCatalog(emptyCatalogRegistry, "kernel", "en", source),
			"kernel",
			"en-XA",
			pseudoLocalizeCatalog(source),
		);
		expect<string>(
			format(registry, "en-XA", {
				key: "item.count",
				namespace: "kernel",
				params: { count: 1, name: "Ana" },
			}),
		).toBe("[1 îîţééɱ ƒööŕ Ana]");
		expect<string>(
			format(registry, "en-XA", { namespace: "kernel", key: "message.unavailable" }),
		).toBe("[Ĝööñéé]");
	});
});
