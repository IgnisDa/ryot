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
	adminHeaders,
	bootSandboxSource,
	type Client,
	createAuthenticatedClient,
	executeQueryEngine,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	installTestPluginBundle,
	type InstalledTestPlugin,
	providerSandboxSource,
	uninstallTestPlugin,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const ENTITY_ALIAS = "entity";
const EXTERNAL_ID = "e2e-plugin-boot-1";
const SCRIPT_SLUG = "movie.e2e-test-boot";
const PROVIDER_SLUG = "movie.e2e-test-boot-provider";
const DETAILS_SCRIPT_SLUG = `${PROVIDER_SLUG}.details`;

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

				const detailsEntry = "scripts/provider-details.sandbox.ts";
				const bootEntry = "scripts/plugin-boot.sandbox.ts";
				const installed = yield* installTestPluginBundle({
					configSchema: { fields: {}, unknownKeys: "strict" },
					files: {
						[bootEntry]: BOOT_SOURCE,
						[detailsEntry]: providerSandboxSource({
							operation: "details",
							slug: DETAILS_SCRIPT_SLUG,
							name: "E2E Test Boot Provider details",
							result: fakeProviderDetailsResult({ name: "E2E Test Boot Provider" }),
						}),
					},
					linkToEntitySchemaSlug: movieSchema.id,
					scripts: [
						{
							kind: "provider",
							entry: detailsEntry,
							slug: DETAILS_SCRIPT_SLUG,
							providerSlug: PROVIDER_SLUG,
							providerOperation: "details",
							name: "E2E Test Boot Provider details",
							capabilities: [],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
						},
						{
							kind: "script",
							entry: bootEntry,
							slug: SCRIPT_SLUG,
							providerSlug: PROVIDER_SLUG,
							name: "E2E Test Boot",
							capabilities: ["upsertGlobalEntities"],
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
						},
					],
					providers: [
						{
							slug: PROVIDER_SLUG,
							name: "E2E Test Boot Provider",
							information: { source: "e2e" },
							operations: { details: DETAILS_SCRIPT_SLUG },
						},
					],
				});
				installed.manifest = {
					...installed.manifest,
					boot: [
						{
							slug: "e2e-test-boot",
							scriptSlug: SCRIPT_SLUG,
							description: "Writes an E2E boot fixture entity",
						},
					],
				};
				yield* getBackendClient().call(
					(c) =>
						c.plugins.install({
							payload: { files: installed.files, manifest: installed.manifest },
						}),
					adminHeaders,
				);
				bootPlugin = installed;
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
		"triggers an installed custom plugin's boot script and writes the entity it defines",
		() =>
			Effect.gen(function* () {
				const { executionId } = yield* getBackendClient().call(
					(c) => c.testSupport.triggerPluginBoot(),
					adminAccessTokenHeaders(ADMIN_TOKEN),
				);
				expect(typeof executionId).toBe("string");
				expect(executionId.length).toBeGreaterThan(0);

				const { data } = yield* executeQueryEngine(queryClient, buildBootEntityQueryDocument());
				const row = data.items[0];

				expect(row).toMatchObject({
					schemaSlug: { kind: "text", value: "movie" },
					name: { kind: "text", value: "E2E Test Boot" },
				});
			}),
	);
});
