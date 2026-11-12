import { expect } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import {
	decodeEntitySourceReference,
	encodeEntitySourceReference,
} from "@ryot-app/contract/modules/ryotql/entity-source";
import { EntityId, PluginId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Result } from "effect";

import { exportSavedArguments } from "./archive/references";
import { rewritePropertyReferences } from "./data-references";
import {
	importSavedArguments,
	rewriteSavedArgumentSources,
	savedArgumentSources,
} from "./saved-arguments";

const collection = encodeEntitySourceReference({
	kind: "collection",
	collectionId: EntityId.make("collection-old"),
});
const pluginView = encodeEntitySourceReference({
	kind: "saved-view",
	reference: { slug: "items", kind: "plugin", pluginId: PluginId.make("plugin-old") },
});
const customView = encodeEntitySourceReference({
	kind: "saved-view",
	reference: { kind: "custom", savedViewId: SavedViewId.make("view-old") },
});
const sourceProperty = {
	type: "string",
	label: "Source",
	description: "Stored selection",
	reference: { kind: "entity-source" },
} as const;
const document: RyotQLDocument = {
	queries: {},
	parameters: {
		fields: {
			plugin: sourceProperty,
			custom: sourceProperty,
			collection: { ...sourceProperty, defaultValue: collection },
			opaque: { label: "Text", type: "string", description: "Ordinary text" },
			entity: {
				type: "string",
				label: "Entity",
				description: "Entity selection",
				reference: { required: true, kind: "entity-id" },
			},
		},
	},
};

it.effect("round-trips saved arguments with defaults, exact source owners and typed IDs", () =>
	Effect.gen(function* () {
		const archived = yield* exportSavedArguments(
			document,
			{ plugin: pluginView, custom: customView, entity: "entity-old", opaque: "entity-old" },
			new Map([["plugin-old", "user:test/package"]]),
		);
		assert(typeof archived["plugin"] === "string");
		expect(Result.getOrThrow(decodeEntitySourceReference(archived["plugin"]))).toEqual({
			kind: "saved-view",
			reference: { slug: "items", kind: "plugin", pluginId: PluginId.make("user:test/package") },
		});
		const rewritten = yield* rewriteSavedArgumentSources(document, archived, (source) => {
			if (source.kind === "collection") {
				return Effect.succeed({ ...source, collectionId: EntityId.make("collection-new") });
			}
			if (source.reference.kind === "custom") {
				return Effect.succeed({
					...source,
					reference: { ...source.reference, savedViewId: SavedViewId.make("view-new") },
				});
			}
			if (source.reference.kind === "plugin") {
				return Effect.succeed({
					...source,
					reference: { ...source.reference, pluginId: PluginId.make("plugin-new") },
				});
			}
			return Effect.succeed(source);
		});
		assert(document.parameters);
		const restored = yield* rewritePropertyReferences(
			rewritten,
			document.parameters,
			new Map([["entity-old", "entity-new"]]),
			new Map(),
		);
		expect(restored).toEqual({
			entity: "entity-new",
			opaque: "entity-old",
			collection: encodeEntitySourceReference({
				kind: "collection",
				collectionId: EntityId.make("collection-new"),
			}),
			custom: encodeEntitySourceReference({
				kind: "saved-view",
				reference: { kind: "custom", savedViewId: SavedViewId.make("view-new") },
			}),
			plugin: encodeEntitySourceReference({
				kind: "saved-view",
				reference: { slug: "items", kind: "plugin", pluginId: PluginId.make("plugin-new") },
			}),
		});
	}),
);
it.effect("rejects malformed source references and unknown saved arguments", () =>
	Effect.gen(function* () {
		const malformed = yield* Effect.result(savedArgumentSources(document, { collection: "bad" }));
		expect(Result.isFailure(malformed)).toBe(true);
		const unknown = yield* Effect.result(savedArgumentSources(document, { unknown: "value" }));
		expect(Result.isFailure(unknown)).toBe(true);
	}),
);

it.effect(
	"keeps visitor parameters unbound while remapping owner sources and tolerates deleted frozen sources",
	() =>
		Effect.gen(function* () {
			const declaration: RyotQLDocument = {
				...document,
				parameters: {
					fields: {
						source: sourceProperty,
						text: { label: "Text", type: "string", description: "Opaque text" },
						visitor: {
							type: "string",
							label: "Visitor",
							description: "Visitor value",
							validation: { required: true },
						},
					},
				},
			};
			const archived = yield* exportSavedArguments(
				declaration,
				{ text: pluginView, source: pluginView },
				new Map([["plugin-old", "system:test/source"]]),
				true,
			);
			const restored = yield* importSavedArguments(
				declaration,
				archived,
				new Map([["system:test/source", "plugin-new"]]),
				new Map(),
				new Map(),
				{ partial: true },
			);
			expect(restored).toEqual({
				text: pluginView,
				source: encodeEntitySourceReference({
					kind: "saved-view",
					reference: { slug: "items", kind: "plugin", pluginId: PluginId.make("plugin-new") },
				}),
			});
			const frozen = yield* importSavedArguments(
				declaration,
				{ source: collection },
				new Map(),
				new Map(),
				new Map(),
				{ frozen: true, partial: true },
			);
			expect(frozen).toEqual({ source: collection });
			const live = yield* Effect.result(
				importSavedArguments(declaration, { source: collection }, new Map(), new Map(), new Map(), {
					partial: true,
				}),
			);
			expect(Result.isFailure(live)).toBe(true);
		}),
);
