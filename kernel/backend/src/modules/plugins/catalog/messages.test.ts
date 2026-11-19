import { expect } from "bun:test";

import { PluginOperationRejected } from "@ryot-app/contract/modules/plugins/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { manifestCatalogs } from "@ryot-app/contract/testing";
import { unavailableMessage } from "@ryot-app/i18n/message";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { MessageRegistry } from "#platform/messages";

import { PluginRepository } from "../packages/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "../packages/revision.test-support";
import { PluginMessageCatalogs, PluginMessageRegistryLive } from "./messages";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");

const catalogPackage = () => {
	const plugin = revisionPackage("catalogs");
	return {
		...plugin,
		catalogs: {
			...manifestCatalogs(plugin.manifest, { "test.provider": "Bottle shop" }),
			fr: { "test.provider": [{ value: "Cave", type: 0 as const }] },
		},
	};
};

layer(
	Layer.mergeAll(PluginMessageCatalogs.layer, PluginMessageRegistryLive).pipe(
		Layer.provideMerge(revisionDatabaseLayer),
	),
)((test) => {
	test.effect("serves one locale's catalogs for the caller's listed plugins", () =>
		Effect.gen(function* () {
			const { pluginId } = yield* installRevisionPackage(catalogPackage(), owner);
			const catalogs = yield* PluginMessageCatalogs;
			expect(yield* catalogs.forUser(owner, "fr")).toEqual({
				catalogs: [
					{ namespace: pluginId, catalog: { "test.provider": [{ type: 0, value: "Cave" }] } },
				],
			});
			expect(yield* catalogs.forUser(owner, "de")).toEqual({ catalogs: [] });
			expect(yield* catalogs.forUser(recipient, "fr")).toEqual({ catalogs: [] });
		}),
	);

	test.effect("renders plugin messages for models until the plugin is deactivated", () =>
		Effect.gen(function* () {
			const { pluginId } = yield* installRevisionPackage(catalogPackage(), owner);
			const messages = yield* MessageRegistry;
			const rejection = new PluginOperationRejected({
				reason: { namespace: pluginId, key: "test.provider" },
			});
			expect(yield* messages.errorForModel(rejection)).toBe("Bottle shop");
			yield* (yield* PluginRepository).deactivate(pluginId);
			expect(yield* messages.errorForModel(rejection)).toBe(
				yield* messages.renderForModel(unavailableMessage),
			);
		}),
	);
});
