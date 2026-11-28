import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { manifestText } from "~/fixtures/kernel/manifest-text";
import { executeRyotQL, requireRows, requireRyotQLText } from "~/fixtures/kernel/ryotql";
import { installTestPlugin, testPluginEntitySchema } from "~/fixtures/kernel/test-plugin";
import { describe, expect, it } from "~/support/effect-test";

describe("Interactive folds", () => {
	it.live("keeps the source write and leaves its subject pending when the fold fails", () =>
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
				source: `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldInput, FoldOutput } from "@ryot-app/plugin-backend-sdk/folds";
export const manifest = defineManifest({ kind: "script", slug: "fold", name: "Failing fold" });
export default defineScript({
  manifest, input: FoldInput, output: FoldOutput,
  run: () => Effect.die("Cannot derive state"),
});`,
				entitySchemas: [
					{
						...testPluginEntitySchema({ slug: "item" }),
						fold: { scriptSlug: "fold", entityProperties: [], eventSchemaSlugs: ["entry"] },
						eventSchemas: [
							{
								slug: "entry",
								name: manifestText("Entry"),
								propertiesSchema: { fields: {} },
								projection: {
									propertiesSchema: {
										unknownKeys: "strict",
										fields: {
											score: { type: "number", description: "Score", label: manifestText("Score") },
										},
									},
								},
							},
						],
					},
				],
			});
			const entity = yield* createEntity(client, {
				name: "Item",
				properties: {},
				entitySchema: {
					slug: EntitySchemaSlug.make("item"),
					owner: { kind: "plugin", pluginId: installed.pluginId },
				},
			});
			yield* client.call((c) =>
				c.events.create({
					payload: [
						{ properties: {}, entityId: entity.id, eventSchemaSlug: EventSchemaSlug.make("entry") },
					],
				}),
			);
			const [created] = yield* listEventsForEntity(client, entity.id, undefined, 10);
			expect(created?.eventSchemaSlug).toBe(EventSchemaSlug.make("entry"));
			const event = table("event", "event");
			const result = yield* executeRyotQL(client, {
				source: {
					kind: "inline",
					document: document({
						events: rows(event, {
							limit: 1,
							where: eq(column(event, "entityId"), literal(entity.id)),
							fields: [field("status", column(event, "projectionStatus"))],
						}),
					}),
				},
			});
			const [status] = requireRows(result.data.events, "events").items;
			expect(status && requireRyotQLText(status, "status")).toBe("pending");
		}),
	);
});
