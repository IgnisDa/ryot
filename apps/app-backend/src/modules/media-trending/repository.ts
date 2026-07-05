import { EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { builtinMediaEntitySchemaSlugs } from "@ryot/plugin-media/schemas/media-schema-slugs";
import { Effect } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import type { TrendingProviderTarget } from "./schemas";

export class MediaTrendingRepository extends Effect.Service<MediaTrendingRepository>()(
	"MediaTrendingRepository",
	{
		effect: Effect.gen(function* () {
			const pluginRuntime = yield* PluginRuntimeResolver;
			const listProviderTargets = Effect.fn("MediaTrendingRepository.listProviderTargets")(
				function* () {
					const rows = yield* pluginRuntime.listSchemaScripts(builtinMediaEntitySchemaSlugs);

					return rows.map(
						({ entitySchemaSlug, script }): TrendingProviderTarget => ({
							scriptSlug: script.slug,
							scriptId: SandboxScriptId.make(script.id),
							entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
						}),
					);
				},
			);

			return { listProviderTargets };
		}),
	},
) {}
