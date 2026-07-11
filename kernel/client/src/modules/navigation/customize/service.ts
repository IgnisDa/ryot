import { Context, Data, Effect, Layer } from "effect";

import { PluginInstallationsApi } from "#/api/plugin-installations";
import { SavedViewsApi } from "#/api/saved-views";
import type { ApiScope } from "#/api/scope";
import type { CustomizePlan } from "#/modules/navigation/customize/customize-plan";

export class CustomizeSaveError extends Data.TaggedError("CustomizeSaveError")<{
	readonly cause: unknown;
	readonly stage: "update" | "reorder" | "workspace";
}> {}

export class CustomizeSidebarService extends Context.Service<CustomizeSidebarService>()(
	"CustomizeSidebarService",
	{
		make: Effect.gen(function* () {
			const savedViews = yield* SavedViewsApi;
			const installations = yield* PluginInstallationsApi;
			const save = Effect.fn("CustomizeSidebarService.save")(function* (
				scope: ApiScope,
				plan: CustomizePlan,
			) {
				for (const update of plan.updates) {
					yield* savedViews
						.update(scope, { payload: update.payload, params: { viewSlug: update.viewSlug } })
						.pipe(Effect.mapError((cause) => new CustomizeSaveError({ cause, stage: "update" })));
				}
				for (const payload of plan.reorders) {
					yield* savedViews
						.reorder(scope, { payload })
						.pipe(Effect.mapError((cause) => new CustomizeSaveError({ cause, stage: "reorder" })));
				}
				for (const update of plan.workspaceUpdates) {
					yield* installations
						.update(scope, { payload: update.payload, params: { pluginSlug: update.pluginSlug } })
						.pipe(
							Effect.mapError((cause) => new CustomizeSaveError({ cause, stage: "workspace" })),
						);
				}
			});

			return { save };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
