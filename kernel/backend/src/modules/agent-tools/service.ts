import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot-app/contract/errors";
import type { PluginOperation } from "@ryot-app/contract/modules/plugins/manifest";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { appSchemaJsonSchema } from "@ryot-app/contract/schema/app-schema-json-schema";
import {
	PluginId,
	type PluginPackageId,
	PluginRevisionId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	allCollectionsRecipe,
	collectionArguments,
	collectionMembersRecipe,
} from "@ryot-app/ryotql-recipes/collections";
import { Context, Effect, Layer, Result, Schema } from "effect";
import type { Headers as PlatformHeaders } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { OperationsService } from "#modules/plugins/operations/service";
import { RyotQLService } from "#modules/ryotql/service";

import { defaultResultByteBudget, minimumResultByteBudget, truncateJsonResult } from "./result";
import { AgentDataDescription } from "./schemas";

export type AgentTool = {
	readonly name: string;
	readonly description: string;
	readonly input: PluginOperation["input"];
	readonly hints: PluginOperation["hints"];
	readonly output: PluginOperation["output"];
	readonly source:
		| { readonly kind: "describe-data" }
		| { readonly kind: "query" | "collections" | "collection-members" }
		| {
				readonly kind: "operation";
				readonly contentHash: string;
				readonly operationSlug: string;
				readonly packageId: PluginPackageId;
		  }
		| {
				readonly query: string;
				readonly pluginId: string;
				readonly revisionId: string;
				readonly kind: "declared-query";
				readonly scope: "user" | "system";
				readonly packageId: PluginPackageId;
		  };
};

const describeDataTool: AgentTool = {
	name: "describe_data",
	output: { type: "object" },
	source: { kind: "describe-data" },
	hints: { readOnly: true, idempotent: true, destructive: false },
	input: { type: "object", properties: {}, additionalProperties: false },
	description:
		"Describe the effective entity, event and relationship schemas, their properties and entity browse fields.",
};

const readHints = { readOnly: true, idempotent: true, destructive: false } as const;
const membersRecipe = collectionMembersRecipe();
const memberParameters = {
	fields: Object.fromEntries(
		Object.entries(membersRecipe.parameters.fields).filter(([key]) => key !== "source"),
	),
};
const queryTools: readonly AgentTool[] = [
	{
		name: "query",
		hints: readHints,
		source: { kind: "query" },
		output: { type: "object" },
		description:
			"Execute an inline RyotQL request using plugin-readable tables and fields. Results are capped at 100 rows per query and a bounded JSON byte budget.",
		input: {
			type: "object",
			required: ["source"],
			additionalProperties: false,
			properties: {
				sort: { type: "string" },
				pages: { type: "object" },
				filter: { type: "object" },
				arguments: { type: "object" },
				source: {
					type: "object",
					required: ["kind", "document"],
					properties: {
						kind: { const: "inline" },
						query: { type: "string" },
						document: { type: "object" },
					},
				},
			},
		},
	},
	{
		hints: readHints,
		name: "collections",
		output: { type: "object" },
		source: { kind: "collections" },
		description: "List the user's collections with forward pagination.",
		input: {
			type: "object",
			additionalProperties: false,
			properties: { pages: { type: "object" } },
		},
	},
	{
		hints: readHints,
		name: "collection-members",
		output: { type: "object" },
		source: { kind: "collection-members" },
		description:
			"Read members of an owned collection using its collectionId, optional searchText, and forward pagination.",
		input: {
			type: "object",
			required: ["arguments"],
			additionalProperties: false,
			properties: {
				sort: { type: "string" },
				pages: { type: "object" },
				filter: { type: "object" },
				arguments: appSchemaJsonSchema(memberParameters),
			},
		},
	},
];
const cappedRequest = (request: ExecutionRequest, document: RyotQLDocument): ExecutionRequest => ({
	...request,
	pages: {
		...request.pages,
		...Object.fromEntries(
			Object.entries(document.queries).flatMap(([name, query]) => {
				if (
					request.source.kind === "inline" &&
					request.source.query !== undefined &&
					request.source.query !== name
				) {
					return [];
				}
				if (query.output.type === "aggregate" && !query.output.groupBy?.length) {
					return [];
				}
				const requested = request.pages?.[name];
				const fallback =
					query.output.type === "rows" ? query.output.pagination.limit : query.output.limit;
				return [
					[name, { ...requested, limit: Math.min(requested?.limit ?? fallback ?? 100, 100) }],
				];
			}),
		),
	},
});

export class AgentToolsService extends Context.Service<AgentToolsService>()(
	"@ryot-app/kernel-backend/modules/agent-tools/service/AgentToolsService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const runtime = yield* PluginRuntimeResolver;
			const definitions = yield* DefinitionRepository;
			const operations = yield* OperationsService;
			const catalogs = yield* DefinitionCatalog;
			const ryotql = yield* RyotQLService;
			const declaredTools = Effect.fn("AgentToolsService.declaredTools")(function* (
				userId: UserId,
			) {
				const catalog = yield* catalogs.forUser(userId);
				const tools: { readonly tool: AgentTool; readonly document: RyotQLDocument }[] = [];
				for (const plugin of catalog.plugins) {
					if (plugin.health !== "ready" || !plugin.isDefinitionEffective || !plugin.isExecutable) {
						continue;
					}
					const revision = yield* catalogs.revision(plugin.activeRevisionId);
					for (const [query, declaration] of Object.entries(revision.sections.queries ?? {})) {
						tools.push({
							document: declaration.document,
							tool: {
								hints: readHints,
								output: { type: "object" },
								description: declaration.description,
								name: `${plugin.packageId.replace("/", ".")}.${query}`,
								source: {
									query,
									scope: plugin.scope,
									kind: "declared-query",
									pluginId: plugin.pluginId,
									packageId: plugin.packageId,
									revisionId: plugin.activeRevisionId,
								},
								input: {
									type: "object",
									additionalProperties: false,
									properties: {
										sort: { type: "string" },
										pages: { type: "object" },
										filter: { type: "object" },
										arguments: appSchemaJsonSchema(
											declaration.document.parameters ?? { fields: {} },
										),
									},
								},
							},
						});
					}
				}
				return tools.sort((left, right) => left.tool.name.localeCompare(right.tool.name));
			});

			const operationTools = Effect.fn("AgentToolsService.operationTools")(function* (
				userId: UserId,
			) {
				const available = yield* runtime.listOperationsAvailableToUser(userId);
				return available
					.flatMap(({ plugin, operation }) => {
						if (operation.auth !== "user") {
							return [];
						}
						const tool: AgentTool = {
							input: operation.input,
							hints: operation.hints,
							output: operation.output,
							description: operation.description,
							name: `${plugin.packageId.replace("/", ".")}.${operation.slug}`,
							source: {
								kind: "operation",
								packageId: plugin.packageId,
								operationSlug: operation.slug,
								contentHash: plugin.contentHash,
							},
						};
						return [
							{
								tool,
								demoAllowed:
									operation.hints.readOnly &&
									plugin.scope === "system" &&
									operation.demoAccess === "allowed",
							},
						];
					})
					.sort((left, right) => left.tool.name.localeCompare(right.tool.name));
			});

			const describeForUser = Effect.fn("AgentToolsService.describeForUser")(function* (
				userId: UserId,
			) {
				const snapshot = yield* definitions.getUserSnapshot(userId, { listed: false });
				return {
					relationshipSchemas: Object.values(snapshot.relationshipSchemas).map(
						({
							slug,
							name,
							pluginId,
							projection,
							propertiesSchema,
							sourceEntitySchemaSlug,
							targetEntitySchemaSlug,
						}) =>
							Object.assign(
								{
									slug,
									name,
									pluginId,
									propertiesSchema,
									sourceEntitySchemaSlug,
									targetEntitySchemaSlug,
								},
								projection ? { projection } : {},
							),
					),
					entitySchemas: Object.values(snapshot.entitySchemas).map((entity) =>
						Object.assign(
							{
								slug: entity.slug,
								name: entity.name,
								pluginId: entity.pluginId,
								propertiesSchema: entity.propertiesSchema,
								eventSchemas: Object.values(entity.eventSchemas).map((event) =>
									Object.assign(
										{
											slug: event.slug,
											name: event.name,
											pluginId: event.pluginId,
											propertiesSchema: event.propertiesSchema,
										},
										event.projection ? { projection: event.projection } : {},
									),
								),
							},
							entity.browse ? { browse: entity.browse } : {},
						),
					),
				};
			});

			const list = Effect.fn("AgentToolsService.list")(function* (
				headers: PlatformHeaders.Headers,
				resource?: string,
			) {
				const { user, authorization } = yield* auth.resolveRequestCredential(
					new Headers(headers),
					resource,
				);
				const tools = yield* operationTools(user.id);
				return [
					describeDataTool,
					...queryTools,
					...(yield* declaredTools(user.id)).map(({ tool }) => tool),
					...tools
						.filter(({ demoAllowed }) => authorization.accessClass !== "demo" || demoAllowed)
						.map(({ tool }) => tool),
				];
			});

			const describeData = Effect.fn("AgentToolsService.describeData")(function* (
				headers: PlatformHeaders.Headers,
			) {
				const { user } = yield* auth.resolveRequestCredential(new Headers(headers));
				return yield* describeForUser(user.id);
			});

			const call = Effect.fn("AgentToolsService.call")(function* (input: {
				readonly name: string;
				readonly resource?: string;
				readonly byteBudget?: number;
				readonly revisionId?: string;
				readonly arguments: JsonValue;
				readonly contentHash?: string;
				readonly idempotencyKey?: string;
				readonly headers: PlatformHeaders.Headers;
			}) {
				const { user, authorization } = yield* auth.resolveRequestCredential(
					new Headers(input.headers),
					input.resource,
				);
				const byteBudget = input.byteBudget ?? defaultResultByteBudget;
				if (!Number.isSafeInteger(byteBudget) || byteBudget < minimumResultByteBudget) {
					return yield* new BadRequest({
						message: `Result byte budget must be an integer of at least ${minimumResultByteBudget}`,
					});
				}
				if (input.name === describeDataTool.name) {
					if (
						input.arguments === null ||
						Array.isArray(input.arguments) ||
						typeof input.arguments !== "object" ||
						Object.keys(input.arguments).length > 0
					) {
						return yield* new BadRequest({ message: "describe_data takes an empty object" });
					}
					const value = yield* Schema.encodeEffect(Schema.toCodecJson(AgentDataDescription))(
						yield* describeForUser(user.id),
					).pipe(Effect.orDie);
					return truncateJsonResult(value, byteBudget);
				}
				const canonical = queryTools.find((tool) => tool.name === input.name);
				const declared = canonical
					? undefined
					: (yield* declaredTools(user.id)).find(({ tool }) => tool.name === input.name);
				if (canonical || declared) {
					const value = yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(
						input.arguments,
					).pipe(Effect.mapError((error) => new BadRequest({ message: error.message })));
					let raw: unknown = value;
					let document: RyotQLDocument;
					const source = declared?.tool.source;
					if (declared && source?.kind === "declared-query") {
						if (input.revisionId !== undefined && input.revisionId !== source.revisionId) {
							return yield* new BadRequest({
								message: "Declared query revision changed; discover tools again",
							});
						}
						document = declared.document;
						raw = {
							...value,
							source: {
								kind: "plugin",
								scope: source.scope,
								query: source.query,
								packageId: source.packageId,
							},
						};
					} else if (
						canonical?.source.kind === "collections" ||
						canonical?.source.kind === "collection-members"
					) {
						document =
							canonical.source.kind === "collections"
								? allCollectionsRecipe.document
								: membersRecipe.document;
						if (canonical.source.kind === "collection-members") {
							const argumentsResult = bindArguments(memberParameters, value["arguments"]);
							if (Result.isFailure(argumentsResult)) {
								return yield* new BadRequest({
									message: argumentsResult.failure.map(({ message }) => message).join("; "),
								});
							}
							const collectionId = argumentsResult.success["collectionId"];
							if (typeof collectionId !== "string") {
								return yield* new BadRequest({ message: "collectionId must be a string" });
							}
							raw = {
								...value,
								source: { document, kind: "inline", query: membersRecipe.query },
								arguments: { ...argumentsResult.success, ...collectionArguments(collectionId) },
							};
						} else {
							raw = { ...value, source: { document, kind: "inline" } };
						}
					} else {
						const parsed = yield* Schema.decodeUnknownEffect(ExecutionRequest)(raw).pipe(
							Effect.mapError((error) => new BadRequest({ message: error.message })),
						);
						if (parsed.source.kind !== "inline") {
							return yield* new BadRequest({ message: "query requires an inline source" });
						}
						document = parsed.source.document;
					}
					const request = yield* Schema.decodeUnknownEffect(ExecutionRequest)(raw).pipe(
						Effect.mapError((error) => new BadRequest({ message: error.message })),
					);
					const result = yield* ryotql
						.executeForUser(
							user.id,
							user.preferences.language,
							"plugin",
							cappedRequest(request, document),
							authorization.accessClass,
							defaultResultByteBudget,
							source?.kind === "declared-query"
								? {
										pluginId: PluginId.make(source.pluginId),
										pluginRevisionId: PluginRevisionId.make(source.revisionId),
									}
								: undefined,
						)
						.pipe(
							Effect.catchTag("RyotQLBadRequest", (error) =>
								error.reason.code === "result-too-large"
									? Effect.succeed(null)
									: Effect.fail(error),
							),
						);
					if (result === null) {
						return { jsonPrefix: "", truncated: true } as const;
					}
					const json = yield* Schema.encodeEffect(Schema.toCodecJson(RyotQLResponse))(result).pipe(
						Effect.orDie,
					);
					return truncateJsonResult(json, Math.min(byteBudget, defaultResultByteBudget));
				}
				const selected = (yield* operationTools(user.id)).find(
					({ tool }) => tool.name === input.name,
				);
				if (selected?.tool.source.kind !== "operation") {
					return yield* new NotFound({ message: `Unknown agent tool: ${input.name}` });
				}
				if (authorization.accessClass === "demo" && !selected.demoAllowed) {
					return yield* new DemoOperationProtected({
						reason: { code: "demo-operation-protected" },
					});
				}
				const result = yield* operations.invoke({
					headers: input.headers,
					...(input.resource === undefined ? {} : { resource: input.resource }),
					payload: input.arguments,
					packageId: selected.tool.source.packageId,
					operationSlug: selected.tool.source.operationSlug,
					contentHash: input.contentHash ?? selected.tool.source.contentHash,
					...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
				});
				return truncateJsonResult(result, byteBudget);
			});

			return { list, call, describeData };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
