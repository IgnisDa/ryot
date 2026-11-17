import { renderConfigReference } from "@ryot-app/config/reference";
import { stampAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import { mapAppSchemaText } from "@ryot-app/contract/schema/property-schema";
import { emptyCatalogRegistry, registerCatalog } from "@ryot-app/i18n/catalog";
import { formatDisplayText, formatForModel } from "@ryot-app/i18n/format";
import { SOURCE_LOCALE } from "@ryot-app/i18n/locale";
import { KERNEL_NAMESPACE, stampNamespace } from "@ryot-app/i18n/message";
import { appConfigDefinition } from "@ryot-app/kernel-backend/platform/config/definition";
import { loadKernelCatalog } from "@ryot-app/kernel-messages/catalog";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect } from "effect";

import { readShippedPlugins } from "../../server/tooling/shipped-plugins";

await Effect.runPromise(
	Effect.gen(function* () {
		const shipped = yield* readShippedPlugins;
		const kernelCatalog = yield* loadKernelCatalog(SOURCE_LOCALE);
		const archives = yield* Effect.forEach(
			shipped,
			({ archive }) =>
				Effect.promise(() => Bun.file(archive).bytes()).pipe(Effect.flatMap(readPluginArchive)),
			{ concurrency: "unbounded" },
		);
		const plugins = archives.map(({ manifest, catalogs }) => {
			const namespace = "plugin";
			const registry = registerCatalog(
				registerCatalog(emptyCatalogRegistry, KERNEL_NAMESPACE, SOURCE_LOCALE, kernelCatalog),
				namespace,
				SOURCE_LOCALE,
				catalogs[SOURCE_LOCALE] ?? {},
			);
			return {
				packageId: manifest.metadata.packageId,
				name: formatForModel(registry, stampNamespace(namespace, manifest.metadata.name)),
				schema: mapAppSchemaText(stampAppSchema(namespace, manifest.configSchema), (text) =>
					formatDisplayText((message) => formatForModel(registry, message), text),
				),
			};
		});
		yield* Effect.promise(() =>
			Bun.write(
				new URL("../src/includes/app-backend-config-schema.md", import.meta.url),
				renderConfigReference(appConfigDefinition, plugins),
			),
		);
	}),
);
