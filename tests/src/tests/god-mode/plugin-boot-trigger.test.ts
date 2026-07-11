import { buildQueryEngineEntityRowsDocument } from "@ryot/query-engine/documents";
import {
	queryEngineComparison,
	queryEngineIdentityFields,
	queryEngineLiteral,
	queryEngineSystemRef,
} from "@ryot/query-engine/primitives";
import { Effect } from "effect";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	bootSandboxSource,
	type Client,
	createAuthenticatedClient,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getBackendClient,
	installTestPlugin,
	type InstalledTestPlugin,
	pollUntil,
	uninstallTestPlugin,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const ENTITY_ALIAS = "entity";
const EXTERNAL_ID = "e2e-plugin-boot-1";
const SCRIPT_SLUG = "movie.e2e-test-boot";

const BOOT_SOURCE = bootSandboxSource({
	slug: SCRIPT_SLUG,
	name: "E2E Test Boot",
	externalId: EXTERNAL_ID,
	entitySchemaSlug: "movie",
});

const buildBootEntityQueryDocument = () =>
	buildQueryEngineEntityRowsDocument({
		limit: 1,
		schemas: ["movie"],
		alias: ENTITY_ALIAS,
		fields: queryEngineIdentityFields(ENTITY_ALIAS),
		where: queryEngineComparison(
			"eq",
			queryEngineSystemRef(ENTITY_ALIAS, "externalId"),
			queryEngineLiteral(EXTERNAL_ID),
		),
	});

let queryClient: Client;
let bootPlugin: InstalledTestPlugin | undefined;

describe("POST /test-support/plugin-boot (custom plugin boot dispatch)", () => {
	beforeAll(async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				queryClient = client;

				const { schema: movieSchema } = yield* findBuiltinSchemaBySlug(client, "movie");

				bootPlugin = yield* installTestPlugin({
					source: BOOT_SOURCE,
					linkToEntitySchemaSlug: movieSchema.id,
					boot: [
						{
							slug: "e2e-test-boot",
							driverRef: SCRIPT_SLUG,
							description: "Writes an E2E boot fixture entity",
						},
					],
					script: {
						kind: "provider",
						slug: SCRIPT_SLUG,
						name: "E2E Test Boot",
						requiredAppConfigKeys: [],
						capabilities: ["upsertGlobalEntities"],
						providerInformation: { source: "e2e" },
					},
				});
			}),
		);
	});

	afterAll(async () => {
		if (bootPlugin) {
			await Effect.runPromise(uninstallTestPlugin(bootPlugin));
		}
	});

	it.live("rejects the trigger without a valid admin token", () =>
		Effect.gen(function* () {
			const client = getBackendClient();

			const missing = yield* Effect.flip(client.call((c) => c.testSupport.triggerPluginBoot()));
			assertTaggedError(missing, "Unauthorized");

			const wrong = yield* Effect.flip(
				client.call(
					(c) => c.testSupport.triggerPluginBoot(),
					adminAccessTokenHeaders("wrong-token"),
				),
			);
			assertTaggedError(wrong, "Unauthorized");
		}),
	);

	it.live(
		"triggers an installed custom plugin's boot driver and writes the entity it defines",
		() =>
			Effect.gen(function* () {
				const { executionId } = yield* getBackendClient().call(
					(c) => c.testSupport.triggerPluginBoot(),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				);
				expect(typeof executionId).toBe("string");
				expect(executionId.length).toBeGreaterThan(0);

				const row = yield* pollUntil(
					"boot-seeded entity for the installed custom plugin",
					Effect.gen(function* () {
						const { data } = yield* executeQueryEngine(queryClient, buildBootEntityQueryDocument());
						return data.items[0] ?? null;
					}),
					{ timeoutMs: 30_000, intervalMs: 1_000 },
				);

				expect(row).toMatchObject({
					schemaSlug: { kind: "text", value: "movie" },
					name: { kind: "text", value: "E2E Test Boot" },
				});
			}),
	);
});
