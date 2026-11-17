import { describe, expect, it } from "bun:test";

import type { CompiledCatalog } from "@ryot-app/i18n/catalog";
import { Result } from "effect";

import { catalogMessagesModule } from "./messages-module";

const catalog: CompiledCatalog = {
	"home.title": [{ type: 0, value: "Home" }],
	"home.status": [
		{ type: 5, value: "status", options: { done: [], other: [{ type: 1, value: "name" }] } },
	],
};

describe("catalogMessagesModule", () => {
	it("types each key from the compiled catalog and documents described keys", () => {
		const module = Result.getOrThrow(
			catalogMessagesModule(catalog, new Map([["home.title", "Page heading"]])),
		);

		expect(module).toStartWith(
			'import { localBindingBuilder, localMessageBuilder, type NoArguments, type SelectArgument, type TextArgument } from "@ryot-app/plugin-kit/messages";',
		);
		expect(module).toContain(
			'\treadonly "home.status": { readonly name: TextArgument; readonly status: SelectArgument<"done">; };',
		);
		expect(module).toContain('\t/** Page heading */\n\treadonly "home.title": NoArguments;');
		expect(module).toContain("export const catalogMessage = localMessageBuilder<Catalog>();");
		expect(module).toContain("export const catalogRowText = localBindingBuilder<Catalog>();");
	});

	it("rejects catalogs that would emit code or exceed the catalog limits", () => {
		const injected = catalogMessagesModule({
			"home.title": [{ type: 1, value: "a: 1 }; globalThis.leak = 1; type T = { b" }],
		});
		const oversized = catalogMessagesModule(
			Object.fromEntries(
				Array.from({ length: 5001 }, (_, index) => [`home.key-${index}`, []] as const),
			),
		);

		expect(Result.isFailure(injected)).toBe(true);
		expect(Result.isFailure(oversized) ? oversized.failure : []).toEqual([
			"error too-many-keys: Catalog has more than 5000 keys",
		]);
	});
});
