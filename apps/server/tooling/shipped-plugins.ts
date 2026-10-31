import { PluginPackageId, pluginPackageSegments } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

const ShippedPluginPackageIds = Schema.fromJsonString(Schema.Array(PluginPackageId));

export const readShippedPlugins = Effect.tryPromise(() =>
	Bun.file(new URL("../shipped-plugins.json", import.meta.url)).text(),
).pipe(
	Effect.flatMap(Schema.decodeEffect(ShippedPluginPackageIds)),
	Effect.map((packageIds) =>
		packageIds.map((packageId) => {
			const root = Bun.fileURLToPath(
				new URL(`../../../plugins/${pluginPackageSegments(packageId).name}`, import.meta.url),
			);
			return { root, packageId, archive: `${root}/dist/${packageId}.zip` };
		}),
	),
);
