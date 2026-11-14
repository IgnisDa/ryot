import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect, Exit } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { installTestPlugin, testPluginEntitySchema } from "~/fixtures/kernel/test-plugin";
import { describe, expect, it } from "~/support/effect-test";

describe("Interactive fold consistency", () => {
	it.live("rolls back the source write when the required fold fails", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const installed = yield* installTestPlugin({
				client,
				script: {
					slug: "fold",
					kind: "script",
					capabilities: [],
					name: "Failing fold",
					requiredPluginConfigKeys: [],
				},
				entitySchemas: [
					{
						...testPluginEntitySchema({ slug: "item" }),
						fold: { scriptSlug: "fold", eventSchemaSlugs: ["entry"] },
						eventSchemas: [{ slug: "entry", name: "Entry", propertiesSchema: { fields: {} } }],
					},
				],
				source: `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldInput, FoldOutput } from "@ryot-app/plugin-backend-sdk/folds";
export const manifest = defineManifest({ kind: "script", slug: "fold", name: "Failing fold" });
export default defineScript({
  manifest, input: FoldInput, output: FoldOutput,
  run: () => Effect.die("Cannot derive required state"),
});`,
			});
			const entity = yield* createEntity(client, {
				name: "Item",
				properties: {},
				entitySchema: {
					slug: EntitySchemaSlug.make("item"),
					owner: { kind: "plugin", pluginId: installed.pluginId },
				},
			});
			const result = yield* client
				.call((c) =>
					c.events.create({
						payload: [
							{
								properties: {},
								entityId: entity.id,
								eventSchemaSlug: EventSchemaSlug.make("entry"),
							},
						],
					}),
				)
				.pipe(Effect.exit);
			expect(Exit.isFailure(result)).toBe(true);
			expect(yield* listEventsForEntity(client, entity.id, undefined, 10)).toEqual([]);
		}),
	);
});
