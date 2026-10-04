import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { Filter } from "@ryot-app/contract/modules/saved-views/filters";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	ascending,
	column,
	document,
	field,
	inArray,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import {
	entityBrowserCountRecipe,
	entityBrowserRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { DateTime, Effect, Schema } from "effect";

import {
	buildSavedViewDataSources,
	createAuthenticatedClient,
	createCollection,
	createEntityFixture,
	createPluginEntitySchema,
	createSavedView,
	entityBrowserSettings,
	executeRyotQLRecipe,
	findSavedViewById,
	getSavedView,
	listInstalledPlugins,
	rowsFields,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	insertLibraryMembership,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { assertPresent, requirePresent, resultToEffect } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const countSavedView = Effect.fn(function* (
	client: Parameters<typeof executeRyotQLRecipe>[0],
	view: {
		readonly dataSources: RyotQLDocument | null;
		readonly settings: Readonly<Record<string, unknown>>;
	},
) {
	const settings = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(view.settings);
	const dataSources = requirePresent(view.dataSources, "Saved view has no data sources");
	const recipe = yield* resultToEffect(entityBrowserCountRecipe(dataSources, settings));
	return yield* executeRyotQLRecipe(client, recipe);
});

const choices = (values: readonly string[]) => ({
	kind: "static" as const,
	values: values.map((value) => ({ value })),
});
const expected = (...entities: readonly { readonly id: string }[]) =>
	sortBy(entities.map(({ id }) => id));

describe("saved views execution", () => {
	it.live("counts rows from the persisted data source and its filter", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, pluginId, reference } = yield* createPluginEntitySchema(client, {
				schemaName: `Saved View Count ${crypto.randomUUID()}`,
			});
			const workspace = requirePresent(
				(yield* listInstalledPlugins(client)).find((plugin) => plugin.pluginId === pluginId),
				"Saved-view workspace installation is missing",
			);
			const matchingNames = [
				`Saved View Count Match One ${crypto.randomUUID()}`,
				`Saved View Count Match Two ${crypto.randomUUID()}`,
			];
			yield* Effect.forEach(
				[...matchingNames, `Saved View Count Other ${crypto.randomUUID()}`],
				(name) => createEntityFixture(client, { name, entitySchema: reference }),
			);

			const entity = table("entity", "entity");
			const base = buildSavedViewDataSources([schemaId], { pluginId, kind: "local" });
			const query = requirePresent(base.queries.savedView, "Saved-view query is missing");
			const dataSources = {
				...base,
				queries: {
					...base.queries,
					savedView: {
						...query,
						where: inArray(
							column(entity, "name"),
							matchingNames.map((name) => literal(name)),
						),
					},
				},
			};
			const settings = entityBrowserSettings(pluginId);
			const created = yield* createSavedView(client, {
				dataSources,
				name: `Saved View Count ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
				settings: {
					...settings,
					subject: {
						...settings.subject,
						schemas: [{ slug: schemaId, owner: { pluginId, kind: "plugin" } }],
					},
				},
			});
			const persisted = yield* findSavedViewById(client, created.id);

			expect(yield* countSavedView(client, persisted)).toBe(2);
		}),
	);

	it.live("executes a built-in data source with per-user isolation", () =>
		Effect.gen(function* () {
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();
			const { schema } = yield* findMediaEntitySchema(userA.client, "show");
			const providerId = schema.providers[0]?.providerId;
			assertPresent(providerId, "Expected a provider for the show schema");
			const entity = yield* seedMediaEntity({
				providerId,
				userId: null,
				entitySchemaSlug: schema.id,
				name: `Isolated All Shows ${crypto.randomUUID()}`,
				externalId: `isolated-all-shows-${crypto.randomUUID()}`,
				properties: {
					genres: [],
					images: [],
					isNsfw: null,
					sourceUrl: null,
					totalSeasons: 0,
					totalEpisodes: 0,
					description: null,
					publishYear: 2019,
					providerRating: 91.4,
					unlinkedCreators: [],
					productionStatus: "Ended",
				},
			});
			yield* insertLibraryMembership(userA.client, { mediaEntityId: entity.id });

			const ownerPluginId =
				schema.reference.owner.kind === "plugin" ? schema.reference.owner.pluginId : undefined;
			assertPresent(ownerPluginId, "Media schema must have a plugin owner");
			const viewReference = { slug: "all-shows", kind: "plugin" as const, pluginId: ownerPluginId };
			const userAView = yield* getSavedView(userA.client, viewReference);
			const userBView = yield* getSavedView(userB.client, viewReference);
			expect(yield* countSavedView(userA.client, userAView)).toBe(1);
			expect(yield* countSavedView(userB.client, userBView)).toBe(0);
		}),
	);

	it.live("executes an entity-browser filter tree with matching page and count", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, pluginId, reference } = yield* createPluginEntitySchema(client, {
				schemaName: `Saved View Filter ${crypto.randomUUID()}`,
				propertiesSchema: {
					fields: {
						reps: { label: "Reps", description: "Reps", type: "integer" as const },
						level: {
							label: "Level",
							description: "Level",
							type: "enum" as const,
							choices: choices(["beginner", "advanced"]),
						},
						muscles: {
							label: "Muscles",
							description: "Muscles",
							type: "enum-array" as const,
							choices: choices(["chest", "back", "legs"]),
						},
					},
				},
			});
			const workspace = requirePresent(
				(yield* listInstalledPlugins(client)).find((plugin) => plugin.pluginId === pluginId),
				"Saved-view workspace installation is missing",
			);
			const create = (name: string, properties: Record<string, unknown>) =>
				createEntityFixture(client, {
					properties,
					entitySchema: reference,
					name: `${name} ${crypto.randomUUID()}`,
				});
			const first = yield* create("First", {
				reps: 5,
				level: "beginner",
				muscles: ["chest", "back"],
			});
			const second = yield* create("Second", { reps: 10, level: "beginner", muscles: ["legs"] });
			const third = yield* create("Third", { reps: 15, level: "advanced", muscles: ["chest"] });
			const fourth = yield* create("Fourth", {});
			const collection = yield* createCollection(client);
			yield* Effect.forEach([first, third], ({ id }) =>
				client.call((c) =>
					c.collections.createMembership({
						payload: { entityId: id, properties: {}, collectionId: collection.id },
					}),
				),
			);

			const entity = table("entity", "entity");
			const entityProperties = column(entity, "properties");
			const base = buildSavedViewDataSources([schemaId], { pluginId, kind: "local" });
			const query = requirePresent(base.queries.savedView, "Saved-view query is missing");
			const dataSources = document({
				savedView: rows(entity, {
					limit: 2,
					where: query.where,
					orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
					fields: [
						...rowsFields,
						field("reps", jsonPath(entityProperties, "reps")),
						field("level", jsonPath(entityProperties, "level")),
						field("muscles", jsonPath(entityProperties, "muscles")),
					],
				}),
			});
			const settings: EntityBrowserSavedViewSettings = {
				...entityBrowserSettings(pluginId),
				pageSize: 50,
				subject: {
					entityAlias: "entity",
					schemas: [{ slug: schemaId, owner: { pluginId, kind: "plugin" as const } }],
				},
				filterFields: [
					{
						key: "reps",
						label: "Reps",
						field: "reps",
						kind: "value" as const,
						type: "number" as const,
					},
					{
						key: "level",
						label: "Level",
						field: "level",
						type: "enum" as const,
						kind: "value" as const,
						choices: [
							{ value: "beginner", label: "Beginner" },
							{ value: "advanced", label: "Advanced" },
						],
					},
					{
						key: "muscles",
						label: "Muscles",
						field: "muscles",
						kind: "value" as const,
						type: "enum-list" as const,
						choices: [
							{ value: "chest", label: "Chest" },
							{ value: "back", label: "Back" },
							{ value: "legs", label: "Legs" },
						],
					},
				],
			};
			const created = yield* createSavedView(client, {
				settings,
				dataSources,
				name: `Saved View Filter ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
			});
			const persisted = yield* findSavedViewById(client, created.id);
			const persistedSettings = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(
				persisted.settings,
			);
			const persistedSources = requirePresent(
				persisted.dataSources,
				"Saved view has no data sources",
			);
			const now = yield* DateTime.now;

			const matching = Effect.fn(function* (filter: Filter) {
				const page = yield* resultToEffect(
					entityBrowserRecipe({
						now,
						filter,
						settings: persistedSettings,
						queryDocument: persistedSources,
					}),
				);
				const count = yield* resultToEffect(
					entityBrowserCountRecipe(persistedSources, persistedSettings, { now, filter }),
				);
				const ids = (yield* executeRyotQLRecipe(client, page)).items.map(
					({ entityId }) => entityId,
				);
				expect(yield* executeRyotQLRecipe(client, count)).toBe(ids.length);
				return sortBy(ids);
			});

			expect(
				yield* matching({
					type: "and",
					filters: [
						{ field: "level", operator: "anyOf", values: ["beginner"] },
						{ field: "muscles", operator: "anyOf", values: ["chest"] },
					],
				}),
			).toEqual(expected(first));
			expect(yield* matching({ field: "level", operator: "noneOf", values: ["beginner"] })).toEqual(
				expected(third, fourth),
			);
			expect(
				yield* matching({ operator: "anyOf", field: "collections", values: [collection.id] }),
			).toEqual(expected(first, third));
			expect(yield* matching({ operator: "empty", field: "collections" })).toEqual(
				expected(second, fourth),
			);
			expect(
				yield* matching({ field: "muscles", operator: "allOf", values: ["chest", "back"] }),
			).toEqual(expected(first));
			expect(yield* matching({ field: "muscles", operator: "empty" })).toEqual(expected(fourth));
			expect(yield* matching({ min: 6, max: 20, field: "reps", operator: "between" })).toEqual(
				expected(second, third),
			);
			expect(
				yield* matching({
					type: "or",
					filters: [
						{ field: "level", operator: "anyOf", values: ["advanced"] },
						{ value: 5, field: "reps", operator: "lte" },
					],
				}),
			).toEqual(expected(first, third));
			expect(
				yield* matching({
					type: "and",
					filters: [
						{ operator: "noneOf", field: "collections", values: [collection.id] },
						{ type: "not", filter: { field: "muscles", values: ["back"], operator: "anyOf" } },
					],
				}),
			).toEqual(expected(second, fourth));
		}),
	);
});
