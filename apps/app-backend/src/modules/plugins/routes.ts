import { HttpApiBuilder } from "@effect/platform";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { PluginIngestionService } from "./service";

export const PluginsRoutesLive = HttpApiBuilder.group(AppContract, "plugins", (handlers) =>
	handlers
		.handle("list", () =>
			Effect.gen(function* () {
				const service = yield* PluginIngestionService;
				return yield* service.listPlugins().pipe(dieOnDbError);
			}),
		)
		.handle("install", ({ payload }) =>
			Effect.gen(function* () {
				const service = yield* PluginIngestionService;
				return yield* service.installPlugin(payload).pipe(dieOnDbError);
			}),
		)
		.handle("uninstall", ({ path }) =>
			Effect.gen(function* () {
				const service = yield* PluginIngestionService;
				return yield* service.uninstallPlugin(path.pluginSlug).pipe(dieOnDbError);
			}),
		),
);
