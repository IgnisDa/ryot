import { ascending, column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	adminAccessTokenHeaders,
	adminHeaders,
	bootSandboxSource,
	type Client,
	createAuthenticatedClient,
	encodeTestSupportPluginFiles,
	executeRyotQL,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getApiClient,
	installTestPluginBundle,
	type InstalledTestPlugin,
	providerSandboxSource,
	requireRows,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

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

const bootEntityQueryDocument = () =>
	document({
		entities: (() => {
			const entity = table("entity", "entity");
			return rows(entity, {
				limit: 1,
				orderBy: [ascending(column(entity, "id"))],
				fields: [
					field("id", column(entity, "id")),
					field("name", column(entity, "name")),
					field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				],
				where: eq(column(entity, "externalId"), literal(EXTERNAL_ID)),
			});
		})(),
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

				const detailsEntry = `backend/providers/${PROVIDER_SLUG}/details.sandbox.ts`;
				const bootEntry = `backend/providers/${PROVIDER_SLUG}/plugin-boot.sandbox.ts`;
				const installed = yield* installTestPluginBundle({
					scope: "system",
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
							rootEntitySchemaSlug: movieSchema.id,
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
				yield* getApiClient().call(
					(c) =>
						c.testSupport.installSystemPlugin({
							payload: {
								manifest: installed.manifest,
								files: encodeTestSupportPluginFiles(installed.files),
							},
						}),
					adminHeaders(),
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
			const client = getApiClient();

			const payload = {
				bootSlug: "e2e-test-boot",
				pluginSlug: requirePresent(bootPlugin, "Boot plugin is not installed").pluginSlug,
			};
			const missing = yield* Effect.flip(
				client.call((c) => c.testSupport.triggerPluginBoot({ payload })),
			);
			assertTaggedError(missing, "AuthUnauthorized");

			const wrong = yield* Effect.flip(
				client.call(
					(c) => c.testSupport.triggerPluginBoot({ payload }),
					adminAccessTokenHeaders("wrong-token"),
				),
			);
			assertTaggedError(wrong, "AuthUnauthorized");
		}),
	);

	it.live(
		"triggers an installed custom plugin's boot script and writes the entity it defines",
		() =>
			Effect.gen(function* () {
				const { executionId } = yield* getApiClient().call(
					(c) =>
						c.testSupport.triggerPluginBoot({
							payload: {
								bootSlug: "e2e-test-boot",
								pluginSlug: requirePresent(bootPlugin, "Boot plugin is not installed").pluginSlug,
							},
						}),
					adminHeaders(),
				);
				expect(typeof executionId).toBe("string");
				expect(executionId.length).toBeGreaterThan(0);

				const { data } = yield* executeRyotQL(queryClient, bootEntityQueryDocument());
				const result = requireRows(data.entities, "entities");
				const row = result.items[0];

				expect(row).toMatchObject({
					entitySchemaSlug: "movie",
					name: "E2E Test Boot",
				});
			}),
	);
});
