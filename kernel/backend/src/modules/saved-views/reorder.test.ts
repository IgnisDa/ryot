import { expect, it } from "@effect/vitest";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { SavedViewBadRequest } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect } from "effect";

import { buildSavedViewReorderPlan } from "./reorder";

const kernel = { slug: "same", kind: "kernel" } as const;
const plugin = { slug: "same", kind: "plugin", pluginId: PluginId.make("owner") } as const;
const custom = { kind: "custom", savedViewId: SavedViewId.make("same") } as const;
const views = [kernel, plugin, custom].map((reference, sortOrder) => ({
	reference,
	sortOrder,
	isHidden: reference.kind === "plugin",
	defaultSortOrder: reference.kind === "custom" ? null : sortOrder,
}));

it.effect(
	"carries exact owners, hidden state and defaults into requested-first shared positions",
	() =>
		Effect.gen(function* () {
			expect(yield* buildSavedViewReorderPlan(views, [custom])).toEqual([
				{ ...views[2], sortOrder: 0, currentSortOrder: 2 },
				{ ...views[0], sortOrder: 1, currentSortOrder: 0 },
				{ ...views[1], sortOrder: 2, currentSortOrder: 1 },
			]);
		}),
);

for (const [issue, references] of [
	["empty", []],
	["duplicate", [custom, custom]],
	["unknown-view", [{ kind: "kernel", slug: "missing" }]],
	["unknown-view", [{ slug: "same", kind: "plugin", pluginId: PluginId.make("other") }]],
] satisfies ReadonlyArray<
	readonly ["empty" | "duplicate" | "unknown-view", ReadonlyArray<SavedViewReference>]
>) {
	it.effect(`rejects ${issue}: ${JSON.stringify(references)}`, () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit(buildSavedViewReorderPlan(views, references)),
				new SavedViewBadRequest({ reason: { issue, references, code: "invalid-reorder" } }),
			);
		}),
	);
}
