import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	installTestProvider,
	searchProviderEntities,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("POST /entity-providers/search", () => {
	it.live("preserves search details when totalItems is unknown", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const identity = yield* randomUuid;
			const rootEntitySchemaSlug = `search-record-${identity}`;
			const provider = yield* Effect.acquireRelease(
				installTestProvider({
					client,
					rootEntitySchemaSlug,
					pluginSlug: `search-unknown-total-${identity}`,
					slug: `search-unknown-total-${identity}.provider`,
					details: fakeProviderDetailsResult({ properties: {}, name: "Search Record" }),
					search: {
						details: { nextPage: 2 },
						items: [{ title: "First Record", externalId: "record-1" }],
					},
					entitySchemas: [
						{
							icon: "file",
							eventSchemas: [],
							name: "Search Record",
							slug: rootEntitySchemaSlug,
							propertiesSchema: { fields: {} },
						},
					],
				}),
				uninstallTestProvider,
			);

			const response = yield* searchProviderEntities(client, {
				page: 1,
				pageSize: 20,
				query: "test",
				providerId: provider.providerId,
			});

			expect(response.items).toEqual([{ title: "First Record", externalId: "record-1" }]);
			expect(response.details).toEqual({ nextPage: 2 });
		}),
	);
});
