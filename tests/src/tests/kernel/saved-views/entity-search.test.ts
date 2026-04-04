import { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	adminHeaders,
	enqueueEntityImport,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getGlobalEntityByProvenance,
	installTestProvider,
	pollEntityImportResult,
	rowsLayouts,
	uninstallTestProvider,
} from "~/fixtures";
import type { Client } from "~/fixtures/auth";
import type { InstalledTestProvider } from "~/fixtures/sandbox-provider";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const viewSlug = `saved-view-search-${crypto.randomUUID()}`;
const externalId = `saved-view-search-${crypto.randomUUID()}`;
const pluginSlug = `saved-view-search-${crypto.randomUUID()}`;
const providerSlug = `book.saved-view-search-${crypto.randomUUID()}`;

let client: Client;
let provider: InstalledTestProvider;
let importedEntityId: EntityId | undefined;

beforeAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const setup = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(setup.client, "book");
			provider = yield* installTestProvider({
				pluginSlug,
				slug: providerSlug,
				client: setup.client,
				linkToEntitySchemaSlug: schema.id,
				name: "Saved View Search Provider",
				search: fakeProviderSearchResult([
					{ externalId, title: "Saved View Search Result", subtitle: 2026 },
				]),
				details: fakeProviderDetailsResult({
					name: "Saved View Imported Book",
					properties: { description: "Imported from configured saved-view search" },
				}),
				savedViews: [
					{
						pluginSlug,
						icon: "book",
						sortOrder: 0,
						slug: viewSlug,
						layouts: rowsLayouts,
						name: "Saved View Search",
						sandboxScripts: { search: [`${providerSlug}.search`] },
					},
				],
			});
			client = (yield* createAuthenticatedClient()).client;
		}),
	);
});

afterAll(async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const entityId = importedEntityId;
			if (entityId) {
				yield* getBackendClient().call(
					(c) => c.testSupport.deleteGlobalEntities({ payload: { ids: [entityId] } }),
					adminHeaders,
				);
			}
			yield* uninstallTestProvider(provider);
		}),
	);
});

describe("saved-view configured entity search and import", () => {
	it.live("searches the allowlisted provider and imports the selected result", () =>
		Effect.gen(function* () {
			const search = yield* client.call((c) =>
				c.savedViews.searchEntities({
					params: { viewSlug },
					payload: { query: "saved view", page: 1, pageSize: 10 },
				}),
			);
			const result = search.providers[0];
			expect(result).toMatchObject({
				status: "success",
				entitySchemaSlug: "book",
				providerId: provider.providerId,
				providerName: "Saved View Search Provider",
			});
			if (result?.status !== "success") {
				throw new Error("Expected configured provider search to succeed");
			}
			const selected = result.items[0];
			if (!selected) {
				throw new Error("Expected a configured provider search result");
			}
			expect(selected).toMatchObject({
				externalId,
				titleProperty: { kind: "text", value: "Saved View Search Result" },
			});

			const { jobId } = yield* enqueueEntityImport(client, {
				providerId: result.providerId,
				externalId: selected.externalId,
				entitySchemaSlug: result.entitySchemaSlug,
			});
			yield* pollEntityImportResult(client, jobId);
			const imported = yield* getGlobalEntityByProvenance(client, {
				providerId: result.providerId,
				externalId: selected.externalId,
				entitySchemaSlug: result.entitySchemaSlug,
			});
			importedEntityId = EntityId.make(imported.id);
			expect(imported.name).toBe("Saved View Imported Book");
		}),
	);
});
