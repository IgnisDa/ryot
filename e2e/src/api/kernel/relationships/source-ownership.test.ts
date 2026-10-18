import {
	definitionOwner,
	type PluginIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	join,
	literal,
	relationshipSchemaPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	enqueueProviderEntityImport,
	executeRyotQLRecipe,
	pollProviderEntityImportResult,
	populateRelatedThroughForegroundInterest,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	fakeProviderDetailsResult,
	installTestProviders,
	uninstallTestProvider,
} from "~/fixtures/kernel/sandbox-provider";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { assertCompleted, assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const ITEM_SCHEMA_SLUG = "catalog-item";
const LABEL_SCHEMA_SLUG = "catalog-label";
const RELATIONSHIP_SCHEMA_SLUG = "item-to-label";
const ITEM_NAME = "E2E Provider Catalog Item";
const LABEL_NAME = "E2E Provider Catalog Label";
const ITEM_PROVIDER_SLUG = `catalog-item-provider-${crypto.randomUUID()}`;
const LABEL_PROVIDER_SLUG = `catalog-label-provider-${crypto.randomUUID()}`;
const ITEM_EXTERNAL_ID = `source-owner-item-${crypto.randomUUID()}`;
const LABEL_EXTERNAL_ID = `source-owner-label-${crypto.randomUUID()}`;
const PLUGIN_SLUG = `relationship-source-ownership-${crypto.randomUUID()}`;

const itemLabelTargetsRecipe = defineRecipe(
	(input: { readonly sourceEntityId: EntityId; readonly owner: PluginIdentityReference }) => {
		const relationship = table("relationship", "itemLabelRelationship");
		const label = table("entity", "label");

		return {
			map: ({ targets }) => Result.succeed(targets.items),
			queries: {
				targets: selectedRows(relationship, {
					limit: 100,
					orderBy: [ascending(column(relationship, "id"))],
					joins: [
						join("inner", label, eq(column(relationship, "targetEntityId"), column(label, "id"))),
					],
					selection: {
						id: selectedField(column(label, "id"), EntityId),
						name: selectedField(column(label, "name"), Schema.String),
						externalId: selectedField(column(label, "externalId"), Schema.NullOr(Schema.String)),
					},
					where: and(
						relationshipSchemaPredicate(relationship, RELATIONSHIP_SCHEMA_SLUG, input.owner),
						eq(column(relationship, "sourceEntityId"), literal(input.sourceEntityId)),
						entitySchemaPredicate(label, LABEL_SCHEMA_SLUG, input.owner),
					),
				}),
			},
		};
	},
);

let client: Client;
let itemProvider: InstalledTestProvider;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			({ client } = yield* createAuthenticatedClient());
			const installed = yield* installTestProviders({
				client,
				scope: "system",
				pluginSlug: PLUGIN_SLUG,
				relationshipSchemas: [
					{
						name: "Item to label",
						slug: RELATIONSHIP_SCHEMA_SLUG,
						userWritePolicy: "source-owner",
						propertiesSchema: { fields: {} },
						sourceEntitySchemaSlug: ITEM_SCHEMA_SLUG,
						targetEntitySchemaSlug: LABEL_SCHEMA_SLUG,
					},
				],
				entitySchemas: [
					{
						icon: "box",
						eventSchemas: [],
						name: "Catalog item",
						slug: ITEM_SCHEMA_SLUG,
						propertiesSchema: { fields: {} },
					},
					{
						icon: "tag",
						eventSchemas: [],
						name: "Catalog label",
						slug: LABEL_SCHEMA_SLUG,
						propertiesSchema: { fields: {} },
					},
				],
				providers: {
					label: {
						slug: LABEL_PROVIDER_SLUG,
						rootEntitySchemaSlug: LABEL_SCHEMA_SLUG,
						details: fakeProviderDetailsResult({ properties: {}, name: LABEL_NAME }),
					},
					item: {
						slug: ITEM_PROVIDER_SLUG,
						rootEntitySchemaSlug: ITEM_SCHEMA_SLUG,
						details: fakeProviderDetailsResult({
							properties: {},
							name: ITEM_NAME,
							relatedEntityGroups: [
								{
									direction: "outgoing",
									synchronization: "authoritative",
									relationshipSchemaSlug: RELATIONSHIP_SCHEMA_SLUG,
									entities: [
										{
											name: LABEL_NAME,
											externalId: LABEL_EXTERNAL_ID,
											providerSlug: LABEL_PROVIDER_SLUG,
										},
									],
								},
							],
						}),
					},
				},
			});
			itemProvider = installed.item;
			({ client } = yield* createAuthenticatedClient());
		}),
	),
);

afterAll(() => runPromise(uninstallTestProvider(itemProvider)));

describe("relationship source ownership", () => {
	it.live("allows provider population but limits user writes to owned sources", () =>
		Effect.gen(function* () {
			const importedJob = yield* enqueueProviderEntityImport(client, {
				externalId: ITEM_EXTERNAL_ID,
				providerId: itemProvider.providerId,
			});
			const imported = yield* pollProviderEntityImportResult(client, importedJob.jobId);
			assertCompleted(imported, "source-owner provider item import");
			yield* populateRelatedThroughForegroundInterest({ client }, imported.data.id);

			const owner = { kind: "local" as const, pluginId: itemProvider.pluginId };
			const targets = yield* executeRyotQLRecipe(
				client,
				itemLabelTargetsRecipe({ owner, sourceEntityId: imported.data.id }),
			);
			expect(targets).toEqual([
				{ name: LABEL_NAME, id: expect.any(String), externalId: LABEL_EXTERNAL_ID },
			]);
			const globalLabel = requirePresent(targets[0], "Expected the provider-linked global label");
			const providerOwner = definitionOwner(itemProvider.pluginId);
			const relationshipSchema = {
				owner: providerOwner,
				slug: RelationshipSchemaSlug.make(RELATIONSHIP_SCHEMA_SLUG),
			};

			const error = yield* Effect.flip(
				client.call((contract) =>
					contract.relationships.create({
						payload: {
							properties: {},
							relationshipSchema,
							targetEntityId: globalLabel.id,
							sourceEntityId: imported.data.id,
						},
					}),
				),
			);
			assertTaggedError(error, "RelationshipBadRequest");
			expect(error.reason).toEqual({ code: "source-not-owned", sourceEntityId: imported.data.id });

			const customItem = yield* createEntity(client, {
				properties: {},
				name: `Custom catalog item ${crypto.randomUUID()}`,
				entitySchema: { owner: providerOwner, slug: EntitySchemaSlug.make(ITEM_SCHEMA_SLUG) },
			});
			const customRelationship = yield* createRelationship(client, {
				properties: {},
				relationshipSchema,
				sourceEntityId: customItem.id,
				targetEntityId: globalLabel.id,
			});
			expect(customRelationship.sourceEntityId).toBe(customItem.id);
			expect(customRelationship.targetEntityId).toBe(globalLabel.id);
		}),
	);
});
