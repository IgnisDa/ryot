import { expect } from "bun:test";

import { AuthUnauthorized, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot-app/contract/errors";
import { PageAuthoringError } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginManifest, PluginOperation } from "@ryot-app/contract/modules/plugins/manifest";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { emptySandboxExecutionMetadata, fixtureManifest } from "@ryot-app/contract/testing";
import {
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	startsWith,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { arrayContaining, objectContaining, stringContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { Headers as PlatformHeaders } from "effect/http";

import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";
import { AuthRepository } from "#modules/accounts/auth/repository";
import { AuthService, resolveTrustedAccount } from "#modules/accounts/auth/service";
import { PageAuthoringService } from "#modules/pages/authoring/service";
import { OperationsService } from "#modules/plugins/operations/service";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { AgentRunSuspended, AgentScriptService } from "#modules/scripts/agent/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { CapabilityCatalog } from "./catalog";
import { AgentDocs } from "./docs";
import type { WriteGate, WriteRequest } from "./execute";
import { KernelCapabilities } from "./kernel-capabilities";
import { AgentToolsService } from "./service";

class Recorded extends Context.Service<Recorded, Ref.Ref<readonly unknown[]>>()(
	"@ryot-app/kernel-backend/modules/agent-tools/service.test/Recorded",
) {}

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const headers = (userId = owner, demo = false) =>
	PlatformHeaders.fromInput({ "x-test-user": userId, "x-test-demo": String(demo) });

const authLayer = Layer.unwrap(
	Effect.gen(function* () {
		const repository = yield* AuthRepository.make;
		const lifecycle = yield* LifecycleWriteGuard.make;
		return Layer.mock(AuthService)({
			handler: () => Promise.reject(new Error("Unused HTTP authentication boundary")),
			resolveTrustedAccount: (userId) =>
				resolveTrustedAccount(userId, repository, lifecycle, recipient),
			resolveRequestCredential: (requestHeaders) => {
				const requestedUserId = requestHeaders.get("x-test-user");
				const userId = [owner, recipient].find((candidate) => candidate === requestedUserId);
				return userId === undefined
					? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
					: Effect.succeed({
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
						});
			},
		});
	}),
);

const servicesLayer = Layer.unwrap(
	Effect.map(Recorded, (calls) => {
		const recordIn = <A>(value: unknown, result: A) =>
			Ref.update(calls, (all) => [...all, value]).pipe(Effect.as(result));
		return Layer.mergeAll(
			Layer.mock(OperationsService)({
				invoke: (input) => recordIn(input, { accepted: input.payload }),
				invokeTrusted: (input) => recordIn(input, { accepted: input.payload }),
			}),
			Layer.mock(SavedViewsService)({}),
			Layer.mock(PageAuthoringService)({
				create: (actor, input, key) =>
					recordIn({ key, actor, create: input.name }, { pageId: "page", draftRevision: 1 }),
				replaceDraft: (actor, input, key) =>
					recordIn(
						{ key, actor, replace: input.pageId },
						{ pageId: input.pageId, draftRevision: input.expectedDraftRevision + 1 },
					),
				compile: (_userId, input, key) => {
					if (input.pageId === "invalid") {
						return Effect.fail(
							new PageAuthoringError({
								reason: { code: "definition-invalid", message: "Query 'items': unknown table" },
							}),
						);
					}
					return input.pageId === "broken"
						? Effect.fail(
								new PageAuthoringError({
									reason: {
										code: "build-failed",
										diagnostics: [
											{
												line: 1,
												column: 1,
												code: "TS1",
												severity: "error",
												message: "Broken",
												file: "client/page.tsx",
											},
										],
									},
								}),
							)
						: recordIn(
								{ key, compile: input },
								{
									pageId: input.pageId,
									artifactHash: "artifact",
									definitionHash: "definition",
									draftRevision: input.expectedDraftRevision,
								},
							);
				},
			}),
			Layer.succeed(AgentDocs, [
				{ topic: "execute", content: "# execute" },
				{ topic: "pages", content: "# Page authoring" },
			]),
			Layer.succeed(AgentScriptService, {
				run: (input) =>
					Effect.gen(function* () {
						const code = input.source.slice(
							input.source.indexOf("{") + 1,
							input.source.indexOf("\n};"),
						);
						const requests = yield* Schema.decodeEffect(
							Schema.fromJsonString(
								Schema.Array(Schema.Struct({ input: JsonValue, id: Schema.String })),
							),
						)(code).pipe(Effect.orDie);
						const outcomes: JsonValue[] = [];
						for (const [index, call] of requests.entries()) {
							const outcome = yield* input
								.invokeCapability(
									{ id: call.id, input: call.input },
									{ index, key: `execution:${index}` },
								)
								.pipe(
									Effect.map((value) => ({ value })),
									Effect.catch((error) =>
										error instanceof AgentRunSuspended
											? Effect.succeed(null)
											: Effect.succeed({ error: error.message }),
									),
								);
							if (outcome === null) {
								return { state: "suspended" as const };
							}
							outcomes.push(outcome);
						}
						return {
							state: "completed" as const,
							result: { value: outcomes, truncated: false as const },
						};
					}),
			}),
		);
	}),
).pipe(Layer.provideMerge(Layer.effect(Recorded, Ref.make<readonly unknown[]>([]))));

const registryLayer = AgentToolsService.layer.pipe(
	Layer.provideMerge(CapabilityCatalog.layer),
	Layer.provideMerge(KernelCapabilities.layer),
	Layer.provideMerge(RyotQLService.layer),
	Layer.provideMerge(Layer.mergeAll(authLayer, servicesLayer)),
	Layer.provideMerge(revisionDatabaseLayer),
	Layer.provide(makeAppConfigLayer()),
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
	title: "Fixture operation",
	description: `Perform ${slug}`,
	hints: { readOnly, idempotent: readOnly, destructive: !readOnly },
	input: { type: "object", properties: { value: { type: "string" } } },
});

const item = table("entity", "item");
const queryParameters = parameters({
	fields: {
		prefix: { type: "string", label: "Prefix", defaultValue: "Item", description: "Name prefix" },
	},
});
const searchDocument = defineRecipe({
	parameters: queryParameters.schema,
	queries: {
		items: selectedRows(item, {
			limit: 1,
			maxLimit: 2,
			selection: { id: selectedField(column(item, "id"), Schema.String) },
			where: startsWith(column(item, "name"), queryParameters.value("prefix")),
		}),
	},
}).document;

const registryPackage = (name: string): NormalizedPlugin => {
	const fixture = fixtureManifest(PluginPackageId.make(`testing/${name}`));
	const manifest: PluginManifest = {
		...fixture,
		hooks: [],
		signalSchemas: [],
		operations: [
			operation("read", true),
			operation("write", false),
			operation("protected", true, "protected"),
		],
		queries: {
			search: {
				title: "Fixture query",
				document: searchDocument,
				description: "Search item names",
			},
		},
		scripts: [
			{
				...emptySandboxExecutionMetadata,
				slug: "run",
				name: "Run",
				kind: "operation",
				entry: "backend/run.sandbox.ts",
			},
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

const recordingGate = (
	decide: (request: WriteRequest) => Effect.Effect<boolean, AgentRunSuspended>,
) =>
	Effect.map(Recorded, (calls): WriteGate => ({
		settle: (request, outcome) =>
			Ref.update(calls, (all) => [...all, { outcome, settled: request.capability.id }]),
		authorize: (request) =>
			decide(request).pipe(
				Effect.map((approved) =>
					approved ? { approved: true } : { approved: false, reason: "Declined in test" },
				),
			),
	}));
const call = (name: string, args: JsonValue, gate: WriteGate, userId = owner, demo = false) =>
	Effect.flatMap(AgentToolsService, (registry) =>
		registry.call({ name, gate, arguments: args, headers: headers(userId, demo) }).pipe(
			Effect.map((outcome) => {
				assert(outcome.state === "completed");
				return outcome;
			}),
		),
	);
const Outcomes = Schema.decodeUnknownEffect(
	Schema.Array(
		Schema.Union([
			Schema.Struct({ value: Schema.Unknown }),
			Schema.Struct({ error: Schema.String }),
		]),
	),
);
const value = (result: AgentToolResult) => {
	assert(!result.truncated);
	return result.value;
};

layer(registryLayer)("agent tools", (test) => {
	test.effect(
		"lists the fixed tools, hides page tools from demo credentials and validates requests",
		() =>
			Effect.gen(function* () {
				const registry = yield* AgentToolsService;
				const gate = yield* recordingGate(() => Effect.succeed(true));
				expect((yield* registry.list(headers())).map(({ name }) => name)).toEqual([
					"search",
					"execute",
					"read_docs",
					"page_write",
					"page_publish",
				]);
				expect((yield* registry.list(headers(owner, true))).map(({ name }) => name)).toEqual([
					"search",
					"execute",
					"read_docs",
				]);
				assertExitFails(
					yield* Effect.exit(registry.list(PlatformHeaders.empty)),
					new AuthUnauthorized({ reason: { code: "authentication-required" } }),
				);
				assertExitFails(
					yield* Effect.exit(call("describe_data", {}, gate)),
					new NotFound({ message: "Unknown agent tool: describe_data" }),
				);
				assertExitFails(
					yield* Effect.exit(
						call("page_publish", { pageId: "page", expectedDraftRevision: 1 }, gate, owner, true),
					),
					new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
				);
				const invalid = yield* Effect.exit(call("search", { detail: "everything" }, gate));
				expect(invalid._tag).toBe("Failure");
				expect(value((yield* call("read_docs", {}, gate)).result)).toEqual({
					topics: ["execute", "pages"],
					instruction: "Call read_docs with one of these topics.",
				});
				expect(value((yield* call("read_docs", { topic: "pages" }, gate)).result)).toEqual({
					page: 1,
					pages: 1,
					topic: "pages",
					content: "# Page authoring",
				});
				assertExitFails(
					yield* Effect.exit(call("read_docs", { topic: "missing" }, gate)),
					new NotFound({ message: "Unknown documentation topic: missing" }),
				);
			}),
		testTimeout,
	);

	test.effect(
		"searches kernel and plugin capabilities under lossless IDs with per-user and demo visibility",
		() =>
			Effect.gen(function* () {
				const gate = yield* recordingGate(() => Effect.succeed(true));
				yield* installRevisionPackage(registryPackage("search-owner"), owner);
				expect(value((yield* call("search", {}, gate)).result)).toMatchObject({
					namespaces: [
						{ writes: 4, namespace: "kernel" },
						{ writes: 1, capabilities: 4, namespace: "testing/search-owner" },
					],
				});
				expect(
					value(
						(yield* call("search", { detail: "names", namespace: "testing/search-owner" }, gate))
							.result,
					),
				).toEqual({
					total: 4,
					capabilities: [
						"testing/search-owner:operations/protected",
						"testing/search-owner:operations/read",
						"testing/search-owner:operations/write",
						"testing/search-owner:queries/search",
					],
				});
				const full = value(
					(yield* call("search", { limit: 1, detail: "full", query: "item names" }, gate)).result,
				);
				expect(full).toMatchObject({
					capabilities: [
						{
							readOnly: true,
							description: "Search item names",
							id: "testing/search-owner:queries/search",
						},
					],
				});
				expect(full).toMatchObject({
					capabilities: [
						{
							types: stringContaining(
								"readonly \"prefix\"?: string | null } & { readonly [x: string]: Json } }\ninput notes:\n  sort: A sort choice key from the query's sort control\n  filter: A filter over the query's filter control fields\n  pages.items: Page of 'items': up to 2 rows; pass the previous pageInfo.nextCursor as after\n  pages.items.after: non-empty\n  pages.items.limit: 1 to 2\n  arguments.prefix: Name prefix\noutput:",
							),
						},
					],
				});
				expect(
					value(
						(yield* call(
							"search",
							{ detail: "names", namespace: "testing/search-owner" },
							gate,
							owner,
							true,
						)).result,
					),
				).toEqual({ total: 1, capabilities: ["testing/search-owner:queries/search"] });
				expect(
					value(
						(yield* call("search", { namespace: "testing/search-owner" }, gate, recipient)).result,
					),
				).toEqual({ total: 0, capabilities: [] });
				const described = yield* Outcomes(
					value(
						(yield* call(
							"execute",
							{
								code: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([
									{
										id: "kernel:data.describe",
										input: { query: "fixture link", namespace: "testing/search-owner" },
									},
									{
										id: "kernel:data.describe",
										input: { limit: 50, detail: "names", namespace: "kernel" },
									},
								]),
							},
							gate,
						)).result,
					),
				);
				expect(described[0]).toEqual({
					value: {
						total: 2,
						items: [
							{
								name: "Fixture Link",
								source: "fixture-entity",
								target: "fixture-entity",
								id: "testing/search-owner:relationships/fixture-link",
								description:
									"Fixture Link relationships: table relationship rows whose relationshipSchemaSlug is 'fixture-link'",
							},
							{
								name: "Fixture",
								events: ["changed"],
								properties: ["kind", "name"],
								id: "testing/search-owner:entities/fixture-entity",
								description:
									"Fixture entities: table entity rows whose entitySchemaSlug is 'fixture-entity', with events in table event",
							},
						],
					},
				});
				expect(described[1]).toMatchObject({
					value: { items: arrayContaining(["kernel:tables/entity", "kernel:tables/event"]) },
				});
			}),
		testTimeout,
	);

	test.effect(
		"executes reads directly, gates writes with pinned sources and returns refusals to the code",
		() =>
			Effect.gen(function* () {
				yield* Ref.set(yield* Recorded, []);
				const installed = yield* installRevisionPackage(registryPackage("execute-owner"), owner);
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.entity)
						.values(
							Array.from({ length: 3 }, (_, index) => ({
								userId: owner,
								id: `item-${index}`,
								name: `Item ${index}`,
								entitySchemaSlug: "item",
							})),
						),
				);
				const calls = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([
					{ input: { value: "read" }, id: "testing/execute-owner:operations/read" },
					{ input: {}, id: "testing/execute-owner:queries/search" },
					{ input: { value: "write" }, id: "testing/execute-owner:operations/write" },
					{ input: {}, id: "testing/execute-owner:operations/missing" },
					{
						input: { pages: { items: { limit: 50 } } },
						id: "testing/execute-owner:queries/search",
					},
					{ input: { arguments: { prefix: 1 } }, id: "testing/execute-owner:queries/search" },
				]);
				let approve = true;
				const recordedCalls = yield* Recorded;
				const gate = yield* recordingGate((request) =>
					Ref.update(recordedCalls, (all) => [
						...all,
						{ index: request.index, authorize: request.capability.id },
					]).pipe(Effect.map(() => approve)),
				);
				const approved = yield* Outcomes(
					value((yield* call("execute", { code: calls }, gate)).result),
				);
				expect(approved[0]).toEqual({ value: { accepted: { value: "read" } } });
				const query = approved[1];
				assert(query !== undefined && "value" in query);
				const response = yield* Schema.decodeUnknownEffect(RyotQLResponse)(query.value);
				const rows = response.data["items"];
				assert(rows?.type === "rows");
				expect(rows.items).toHaveLength(1);
				const paged = approved[4];
				assert(paged !== undefined && "value" in paged);
				const pagedRows = (yield* Schema.decodeUnknownEffect(RyotQLResponse)(paged.value)).data[
					"items"
				];
				assert(pagedRows?.type === "rows");
				expect(pagedRows.items).toHaveLength(2);
				const refused = approved[5];
				assert(refused !== undefined && "error" in refused);
				expect(refused.error).toContain("Invalid arguments: prefix: ");
				expect(approved[2]).toEqual({ value: { accepted: { value: "write" } } });
				expect(approved[3]).toEqual({
					error:
						"Unknown capability: testing/execute-owner:operations/missing. Use search to find capability IDs.",
				});
				const recorded = yield* Ref.get(yield* Recorded);
				expect(recorded).toContainEqual({
					index: 2,
					authorize: "testing/execute-owner:operations/write",
				});
				expect(recorded).toContainEqual({
					settled: "testing/execute-owner:operations/write",
					outcome: { state: "success", value: { accepted: { value: "write" } } },
				});
				expect(recorded).toContainEqual(
					objectContaining({
						operationSlug: "write",
						payload: { value: "write" },
						idempotencyKey: "execution:2",
						sourcePin: objectContaining({ revisionId: installed.revisionId }),
					}),
				);
				expect(
					recorded.filter(
						(entry) => typeof entry === "object" && entry !== null && "authorize" in entry,
					),
				).toHaveLength(1);
				approve = false;
				const declined = yield* Outcomes(
					value((yield* call("execute", { code: calls }, gate)).result),
				);
				expect(declined[2]).toEqual({ error: "Declined in test" });
				const suspended = yield* (yield* AgentToolsService).call({
					name: "execute",
					headers: headers(),
					arguments: { code: calls },
					gate: yield* recordingGate(() => Effect.fail(new AgentRunSuspended())),
				});
				expect(suspended).toEqual({ state: "suspended" });
			}),
		testTimeout,
	);

	test.effect(
		"writes and compiles pages in one call and returns build diagnostics as results",
		() =>
			Effect.gen(function* () {
				yield* Ref.set(yield* Recorded, []);
				const gate = yield* recordingGate(() => Effect.succeed(true));
				const definition = {
					files: [],
					pluginDependencies: {},
					queries: { queries: {} },
					entry: "client/page.tsx",
				};
				const created = yield* (yield* AgentToolsService).call({
					gate,
					name: "page_write",
					headers: headers(),
					idempotencyKey: "write",
					arguments: { definition, name: "Page", slug: "page" },
				});
				expect(created).toEqual({
					state: "completed",
					preview: {
						pageId: "page",
						draftRevision: 1,
						artifactHash: "artifact",
						definitionHash: "definition",
					},
					result: {
						truncated: false,
						value: {
							pageId: "page",
							draftRevision: 1,
							artifactHash: "artifact",
							definitionHash: "definition",
						},
					},
				});
				expect(yield* Ref.get(yield* Recorded)).toEqual([
					{ create: "Page", key: "write:draft", actor: { userId: owner, kind: "assistant" } },
					{ key: "write:compile", compile: { pageId: "page", expectedDraftRevision: 1 } },
				]);
				const broken = yield* call(
					"page_write",
					{ definition, pageId: "broken", expectedDraftRevision: 3 },
					gate,
				);
				expect(broken.preview).toBeUndefined();
				expect(value(broken.result)).toMatchObject({
					pageId: "broken",
					draftRevision: 4,
					error: { code: "build-failed", diagnostics: [{ message: "Broken" }] },
				});
				const invalid = yield* call(
					"page_write",
					{ definition, pageId: "invalid", expectedDraftRevision: 1 },
					gate,
				);
				expect(value(invalid.result)).toEqual({
					draftRevision: 2,
					pageId: "invalid",
					instruction: "Repair the page and write it again with this draftRevision.",
					error: { code: "definition-invalid", message: "Query 'items': unknown table" },
				});
				assertExitFails(
					yield* Effect.exit(call("page_write", { definition }, gate)),
					new BadRequest({
						message:
							"Supply name and slug to create a page, or pageId and expectedDraftRevision to replace a draft",
					}),
				);
			}),
		testTimeout,
	);
});
