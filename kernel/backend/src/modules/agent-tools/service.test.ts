import { expect } from "bun:test";

import { AuthUnauthorized, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot-app/contract/errors";
import type { AuthoredEntitySchemaBrowse } from "@ryot-app/contract/modules/filters/browse";
import type { PluginManifest, PluginOperation } from "@ryot-app/contract/modules/plugins/manifest";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { emptySandboxExecutionMetadata, fixtureManifest } from "@ryot-app/contract/testing";
import {
	column,
	defineRecipe,
	field,
	literal,
	rows,
	selectedField,
	selectedRows,
	startsWith,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Result, Schema } from "effect";
import { Headers as PlatformHeaders } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import { OperationsService } from "#modules/plugins/operations/service";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { AgentToolsService } from "./service";

type Invocation = Parameters<OperationsService["Service"]["invoke"]>[0];
class Invocations extends Context.Service<Invocations, Ref.Ref<readonly Invocation[]>>()(
	"@ryot-app/kernel-backend/modules/agent-tools/service.test/Invocations",
) {}

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const headers = (userId = owner, demo = false) =>
	PlatformHeaders.fromInput({ "x-test-user": userId, "x-test-demo": String(demo) });

const authLayer = Layer.mock(AuthService)({
	handler: () => Promise.reject(new Error("Unused HTTP authentication boundary")),
	resolveRequestCredential: (requestHeaders) => {
		const requestedUserId = requestHeaders.get("x-test-user");
		const userId = [owner, recipient].find((candidate) => candidate === requestedUserId);
		return userId === owner || userId === recipient
			? Effect.succeed({
					authorization: {
						userId,
						credential: { kind: "api-key", keyId: "registry-test" },
						accessClass: requestHeaders.get("x-test-demo") === "true" ? "demo" : "standard",
					},
					user: {
						id: userId,
						image: null,
						name: "User",
						accountUserId: userId,
						email: `${userId}@example.test`,
						preferences: {
							language: null,
							reportingTimeZone: UTC,
							ratingScale: "hundred",
							disableIntegrations: false,
						},
					},
				})
			: Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }));
	},
});
const recordingLayer = Layer.effect(Invocations, Ref.make<readonly Invocation[]>([]));
const operationsLayer = Layer.unwrap(
	Effect.map(Invocations, (calls) =>
		Layer.mock(OperationsService)({
			invoke: (input) =>
				Ref.update(calls, (all) => [...all, input]).pipe(Effect.as({ accepted: input.payload })),
		}),
	),
).pipe(Layer.provideMerge(recordingLayer));

const registryLayer = AgentToolsService.layer.pipe(
	Layer.provide(RyotQLService.layer),
	Layer.provideMerge(Layer.mergeAll(authLayer, operationsLayer)),
	Layer.provideMerge(revisionDatabaseLayer),
);

const operation = (
	slug: string,
	readOnly: boolean,
	demoAccess: "allowed" | "protected" = "allowed",
): PluginOperation => ({
	slug,
	demoAccess,
	auth: "user",
	scriptSlug: "run",
	output: { type: "object" },
	description: `Perform ${slug}`,
	hints: { readOnly, idempotent: readOnly, destructive: !readOnly },
	input: { type: "object", properties: { value: { type: "string" } } },
});

const registryPackage = (name: string): NormalizedPlugin => {
	const fixture = fixtureManifest(PluginPackageId.make(`testing/${name}`));
	const manifest: PluginManifest = {
		...fixture,
		hooks: [],
		signalSchemas: [],
		scripts: [
			{
				...emptySandboxExecutionMetadata,
				slug: "run",
				name: "Run",
				kind: "operation",
				entry: "backend/run.sandbox.ts",
			},
			{
				...emptySandboxExecutionMetadata,
				kind: "script",
				slug: "utility",
				name: "Utility",
				entry: "backend/utility.sandbox.ts",
			},
		],
		entitySchemas: fixture.entitySchemas.map((entity) =>
			Object.assign({}, entity, {
				browse: {
					fields: [
						{
							type: "text",
							kind: "value",
							label: "Name",
							key: "displayName",
							expression: { field: "name", type: "column", tableAlias: "subject" },
						},
					],
				} satisfies AuthoredEntitySchemaBrowse,
			}),
		),
		operations: [
			operation("read", true),
			operation("write", false),
			operation("protected", true, "protected"),
			{
				scriptSlug: "run",
				slug: "integration",
				auth: "integration",
				input: { type: "object" },
				output: { type: "object" },
				description: "Integration only",
				hints: { readOnly: true, idempotent: true, destructive: false },
			},
			{ ...operation("unavailable", true), scriptSlug: "utility" },
		],
	};
	return {
		manifest,
		contentHash: `${name}-content`,
		scripts: manifest.scripts.map(({ entry, ...metadata }) => ({
			entry,
			metadata,
			compiledFormat: 1,
			slug: metadata.slug,
			name: metadata.name,
			contentHash: `${name}-script`,
			compiledCode: "export default () => null;",
		})),
	};
};

layer(registryLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"agent tool discovery and dispatch",
	(test) => {
		test.effect(
			"discovers executable owner operations with manifest schemas and delegates pinned dispatch",
			() =>
				Effect.gen(function* () {
					const registry = yield* AgentToolsService;
					const installed = yield* installRevisionPackage(registryPackage("private"), owner);
					const tools = yield* registry.list(headers());
					expect(tools.map(({ name }) => name)).toEqual([
						"describe_data",
						"query",
						"collections",
						"collection-members",
						"testing.private.protected",
						"testing.private.read",
						"testing.private.write",
					]);
					const read = tools.find(({ name }) => name === "testing.private.read");
					assert(read?.source.kind === "operation");
					expect(read.input).toEqual(operation("read", true).input);
					expect(read.output).toEqual({ type: "object" });
					expect(read.hints).toEqual({ readOnly: true, idempotent: true, destructive: false });
					expect((yield* registry.list(headers(recipient))).map(({ name }) => name)).toEqual([
						"describe_data",
						"query",
						"collections",
						"collection-members",
					]);
					expect(
						yield* registry.call({
							name: read.name,
							headers: headers(),
							idempotencyKey: "request",
							arguments: { value: "input" },
							contentHash: read.source.contentHash,
						}),
					).toEqual({ truncated: false, value: { accepted: { value: "input" } } });
					expect(yield* Ref.get(yield* Invocations)).toEqual([
						{
							headers: headers(),
							operationSlug: "read",
							idempotencyKey: "request",
							payload: { value: "input" },
							contentHash: "private-content",
							packageId: read.source.packageId,
						},
					]);
					assertExitFails(
						yield* Effect.exit(
							registry.call({ arguments: {}, name: read.name, headers: headers(recipient) }),
						),
						new NotFound({ message: `Unknown agent tool: ${read.name}` }),
					);
					yield* (yield* DatabaseSession).run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ isHidden: true })
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					expect((yield* registry.list(headers())).map(({ name }) => name)).toEqual([
						"describe_data",
						"query",
						"collections",
						"collection-members",
					]);
				}),
			testTimeout,
		);
	},
);

layer(registryLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"agent tool availability",
	(test) => {
		test.effect(
			"enforces readiness and usable configuration on each discovery",
			() =>
				Effect.gen(function* () {
					const registry = yield* AgentToolsService;
					const installed = yield* installRevisionPackage(registryPackage("availability"), owner);
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ health: "installing" })
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					expect((yield* registry.list(headers())).map(({ name }) => name)).toEqual([
						"describe_data",
						"query",
						"collections",
						"collection-members",
					]);
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ health: "ready", activeConfigRevisionId: null })
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					expect((yield* registry.list(headers())).map(({ name }) => name)).toEqual([
						"describe_data",
						"query",
						"collections",
						"collection-members",
					]);
				}),
			testTimeout,
		);
	},
);

layer(registryLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"agent tool demo authority",
	(test) => {
		test.effect(
			"filters and refuses semantic writes for demos even when demoAccess allows them",
			() =>
				Effect.gen(function* () {
					const registry = yield* AgentToolsService;
					yield* installRevisionPackage(registryPackage("system"));
					yield* installRevisionPackage(registryPackage("demo-private"), owner);
					expect((yield* registry.list(headers(owner, true))).map(({ name }) => name)).toEqual([
						"describe_data",
						"query",
						"collections",
						"collection-members",
						"testing.system.read",
					]);
					for (const name of [
						"testing.system.write",
						"testing.system.protected",
						"testing.demo-private.read",
					]) {
						assertExitFails(
							yield* Effect.exit(
								registry.call({ name, arguments: {}, headers: headers(owner, true) }),
							),
							new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
						);
					}
					expect(yield* Ref.get(yield* Invocations)).toEqual([]);
				}),
			testTimeout,
		);
	},
);

layer(registryLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"agent tool data descriptions",
	(test) => {
		test.effect(
			"describes effective properties, nested events, relationships and browse fields",
			() =>
				Effect.gen(function* () {
					const registry = yield* AgentToolsService;
					const installed = yield* installRevisionPackage(registryPackage("definitions"), owner);
					const data = yield* registry.describeData(headers());
					const entity = data.entitySchemas.find(({ pluginId }) => pluginId === installed.pluginId);
					assert(entity);
					expect(entity.propertiesSchema.fields["name"]).toEqual({
						label: "Name",
						type: "string",
						description: "Fixture name",
					});
					expect(entity.browse?.fields.map(({ key }) => key)).toEqual(["displayName"]);
					expect(
						entity.eventSchemas.map(({ slug, propertiesSchema }) => ({ slug, propertiesSchema })),
					).toEqual([
						{
							slug: "changed",
							propertiesSchema: {
								fields: { value: { type: "string", label: "Value", description: "Changed value" } },
							},
						},
					]);
					expect(
						data.relationshipSchemas
							.filter(({ pluginId }) => pluginId === installed.pluginId)
							.map(({ slug, sourceEntitySchemaSlug, targetEntitySchemaSlug }) => ({
								slug,
								sourceEntitySchemaSlug,
								targetEntitySchemaSlug,
							})),
					).toEqual([
						{
							slug: "fixture-link",
							sourceEntitySchemaSlug: "fixture-entity",
							targetEntitySchemaSlug: "fixture-entity",
						},
					]);
					expect(
						(yield* registry.describeData(headers(recipient))).entitySchemas.some(
							({ pluginId }) => pluginId === installed.pluginId,
						),
					).toBe(false);
					const bounded = yield* registry.call({
						arguments: {},
						byteBudget: 64,
						headers: headers(),
						name: "describe_data",
					});
					expect(bounded.truncated).toBe(true);
					expect(
						new TextEncoder().encode(
							yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(bounded),
						).length,
					).toBeLessThanOrEqual(64);
				}),
			testTimeout,
		);
	},
);

layer(registryLayer.pipe(Layer.provide(makeAppConfigLayer())))(
	"agent tool request validation",
	(test) => {
		test.effect(
			"rejects missing credentials and invalid requests before dispatch",
			() =>
				Effect.gen(function* () {
					const registry = yield* AgentToolsService;
					assertExitFails(
						yield* Effect.exit(registry.list(PlatformHeaders.empty)),
						new AuthUnauthorized({ reason: { code: "authentication-required" } }),
					);
					assertExitFails(
						yield* Effect.exit(
							registry.call({
								headers: headers(),
								name: "describe_data",
								arguments: { extra: true },
							}),
						),
						new BadRequest({ message: "describe_data takes an empty object" }),
					);
					assertExitFails(
						yield* Effect.exit(
							registry.call({
								arguments: {},
								byteBudget: 63,
								headers: headers(),
								name: "describe_data",
							}),
						),
						new BadRequest({ message: "Result byte budget must be an integer of at least 64" }),
					);
					expect(yield* Ref.get(yield* Invocations)).toEqual([]);
				}),
			testTimeout,
		);
	},
);

layer(registryLayer.pipe(Layer.provide(makeAppConfigLayer())))("agent query registry", (test) => {
	test.effect(
		"discovers persisted query parameters and applies defaults, row caps and demo authority",
		() =>
			Effect.gen(function* () {
				const registry = yield* AgentToolsService;
				const item = table("entity", "item");
				const queryParameters = parameters({
					fields: {
						prefix: {
							type: "string",
							label: "Prefix",
							defaultValue: "Item",
							description: "Name prefix",
						},
					},
				});
				const document = defineRecipe({
					parameters: queryParameters.schema,
					queries: {
						items: selectedRows(item, {
							limit: 1,
							maxLimit: 200,
							where: startsWith(column(item, "name"), queryParameters.value("prefix")),
							selection: {
								id: selectedField(column(item, "id"), Schema.String),
								owner: selectedField(
									{ type: "pluginId", reference: { kind: "self" } },
									Schema.String,
								),
							},
						}),
					},
				}).document;
				const fixture = registryPackage("queries");
				const installed = yield* installRevisionPackage(
					{
						...fixture,
						manifest: {
							...fixture.manifest,
							queries: { search: { document, description: "Search item names" } },
						},
					},
					owner,
				);
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.entity)
						.values(
							Array.from({ length: 105 }, (_, index) => ({
								userId: owner,
								id: `item-${index}`,
								name: `Item ${index}`,
								entitySchemaSlug: "item",
							})),
						),
				);
				const listed = (yield* registry.list(headers())).find(
					(tool) => tool.name === "testing.queries.search",
				);
				assert(listed?.source.kind === "declared-query");
				expect(listed.input).toMatchObject({
					properties: { arguments: { properties: { prefix: { default: "Item" } } } },
				});
				const first = yield* registry.call({
					arguments: {},
					name: listed.name,
					headers: headers(owner, true),
					revisionId: listed.source.revisionId,
				});
				assert(!first.truncated);
				const response = yield* Schema.decodeUnknownEffect(RyotQLResponse)(first.value);
				const result = response.data["items"];
				assert(result?.type === "rows");
				expect(result.items).toHaveLength(1);
				expect(result.items[0]?.["owner"]).toBe(installed.pluginId);
				const capped = yield* registry.call({
					name: listed.name,
					headers: headers(),
					arguments: { pages: { items: { limit: 200 } } },
				});
				assert(!capped.truncated);
				const cappedResponse = yield* Schema.decodeUnknownEffect(RyotQLResponse)(capped.value);
				const cappedRows = cappedResponse.data["items"];
				assert(cappedRows?.type === "rows");
				expect(cappedRows.items).toHaveLength(100);
				expect(cappedRows.pageInfo.hasMore).toBe(true);
				const invalid = yield* Effect.result(
					registry.call({
						name: listed.name,
						headers: headers(),
						arguments: { arguments: { prefix: 7 } },
					}),
				);
				expect(Result.isFailure(invalid)).toBe(true);
				const stale = yield* Effect.result(
					registry.call({
						arguments: {},
						name: listed.name,
						headers: headers(),
						revisionId: "stale",
					}),
				);
				expect(Result.isFailure(stale)).toBe(true);
				const generic = yield* registry.call({
					name: "query",
					headers: headers(owner, true),
					arguments: yield* Schema.encodeEffect(Schema.toCodecJson(ExecutionRequest))({
						source: {
							kind: "inline",
							document: {
								queries: { items: rows(item, { fields: [field("id", column(item, "id"))] }) },
							},
						},
					}),
				});
				expect(generic.truncated).toBe(false);
				const short = yield* registry.call({
					name: "query",
					byteBudget: 64,
					headers: headers(),
					arguments: yield* Schema.encodeEffect(Schema.toCodecJson(ExecutionRequest))({
						source: {
							kind: "inline",
							document: {
								queries: { items: rows(item, { fields: [field("id", column(item, "id"))] }) },
							},
						},
					}),
				});
				expect(short.truncated).toBe(true);
				const shortJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(short);
				expect(new TextEncoder().encode(shortJson).length).toBeLessThanOrEqual(64);
				const oversized = yield* registry.call({
					name: "query",
					headers: headers(),
					arguments: yield* Schema.encodeEffect(Schema.toCodecJson(ExecutionRequest))({
						source: {
							kind: "inline",
							document: {
								queries: {
									items: rows(item, {
										limit: 1,
										fields: [field("text", literal("界".repeat(30_000)))],
									}),
								},
							},
						},
					}),
				});
				expect(oversized).toEqual({ jsonPrefix: "", truncated: true });
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId: owner,
							id: "collection",
							name: "Collection",
							entitySchemaSlug: "collection",
						}),
				);
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.relationship)
						.values({
							userId: owner,
							id: "membership",
							properties: { rank: 0 },
							sourceEntityId: "item-0",
							targetEntityId: "collection",
							relationshipSchemaSlug: "member-of",
						}),
				);
				const collections = yield* registry.call({
					arguments: {},
					name: "collections",
					headers: headers(owner, true),
				});
				assert(!collections.truncated);
				const collectionRows = yield* Schema.decodeUnknownEffect(RyotQLResponse)(collections.value);
				expect(collectionRows.data["collections"]?.items).toEqual([
					{ id: "collection", name: "Collection" },
				]);
				const members = yield* registry.call({
					name: "collection-members",
					headers: headers(owner, true),
					arguments: { arguments: { collectionId: "collection" } },
				});
				assert(!members.truncated);
				const memberRows = yield* Schema.decodeUnknownEffect(RyotQLResponse)(members.value);
				expect(Object.keys(memberRows.data)).toEqual(["members"]);
				expect(memberRows.data["members"]?.items.map((row) => row["entityId"])).toEqual(["item-0"]);
				for (const [requestHeaders, argumentsValue] of [
					[headers(recipient), { collectionId: "collection" }],
					[headers(), { collectionId: "collection", source: "caller-controlled" }],
				] as const) {
					expect(
						Result.isFailure(
							yield* Effect.result(
								registry.call({
									headers: requestHeaders,
									name: "collection-members",
									arguments: { arguments: argumentsValue },
								}),
							),
						),
					).toBe(true);
				}

				const denied = yield* Effect.result(
					registry.call({
						name: "query",
						headers: headers(owner, true),
						arguments: yield* Schema.encodeEffect(Schema.toCodecJson(ExecutionRequest))({
							source: {
								kind: "inline",
								document: { queries: { runs: rows(table("backupRun", "run"), { fields: [] }) } },
							},
						}),
					}),
				);
				expect(Result.isFailure(denied)).toBe(true);
			}),
		testTimeout,
	);
});
