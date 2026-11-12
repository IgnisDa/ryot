import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot-app/contract/errors";
import { PageIdBody } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginOperationJsonSchema } from "@ryot-app/contract/modules/plugins/manifest";
import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import {
	CreateSavedViewBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { toAgentJsonSchema } from "@ryot-app/contract/schema/agent-tool";
import { appSchemaJsonSchema } from "@ryot-app/contract/schema/app-schema-json-schema";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { type Capability, kernelCapabilityId } from "@ryot-app/contract/schema/capability";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	allCollectionsRecipe,
	collectionArguments,
	collectionMembersRecipe,
} from "@ryot-app/ryotql-recipes/collections";
import { pageRecipe, pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import {
	savedViewRecordRecipe,
	savedViewRecordsRecipe,
} from "@ryot-app/ryotql-recipes/saved-view-records";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { PageAuthoringService } from "#modules/pages/authoring/service";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { defaultResultByteBudget } from "#platform/tool-result";

import { AgentDataDescription } from "./schemas";

type CapabilityFailure = { readonly message: string };
type KernelCapabilityContext = {
	readonly user: CurrentUserValue;
	readonly idempotencyKey?: string;
	readonly accessClass: "demo" | "standard";
};

export const readHints = { readOnly: true, idempotent: true, destructive: false } as const;
const writeHints = { readOnly: false, idempotent: false, destructive: false } as const;
const deleteHints = { readOnly: false, idempotent: false, destructive: true } as const;
const objectOutput: PluginOperationJsonSchema = { type: "object" };
export const ryotqlOutput = toAgentJsonSchema(Schema.toCodecJson(RyotQLResponse));

const Pages = Schema.Record(
	Schema.String,
	Schema.Struct({
		after: Schema.optional(Schema.NonEmptyString),
		limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
	}),
);
const ReadRequest = Schema.Struct({
	pages: Schema.optional(Pages),
	arguments: Schema.optional(Schema.Record(Schema.String, JsonValue)),
});
const QueryRequest = Schema.Struct({
	sort: Schema.optional(Schema.String),
	pages: Schema.optional(Schema.Record(Schema.String, JsonValue)),
	filter: Schema.optional(Schema.Record(Schema.String, JsonValue)),
	arguments: Schema.optional(Schema.Record(Schema.String, JsonValue)),
});
const membersRecipe = collectionMembersRecipe();
const memberParameters = {
	fields: Object.fromEntries(
		Object.entries(membersRecipe.parameters.fields).filter(([key]) => key !== "source"),
	),
};

export const declaredQueryInput = (document: RyotQLDocument): PluginOperationJsonSchema => ({
	type: "object",
	additionalProperties: false,
	properties: {
		sort: { type: "string" },
		pages: { type: "object" },
		filter: { type: "object" },
		arguments: appSchemaJsonSchema(document.parameters ?? { fields: {} }),
	},
});

export const cappedRequest = (
	request: ExecutionRequest,
	document: RyotQLDocument,
): ExecutionRequest => ({
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

export const boundedQuery = <A, R>(
	query: Effect.Effect<A, RyotQLBadRequest | CapabilityFailure, R>,
) =>
	query.pipe(
		Effect.catchTag("RyotQLBadRequest", (error) =>
			Effect.fail(
				error.reason.code === "result-too-large"
					? new BadRequest({
							message: "The query result is too large. Request fewer rows or fields, or paginate.",
						})
					: error,
			),
		),
	);

const decodeRequest = (raw: unknown) =>
	Schema.decodeUnknownEffect(ExecutionRequest)(raw).pipe(
		Effect.mapError((error) => new BadRequest({ message: error.message })),
	);

type KernelCapabilityDefinition = {
	readonly capability: Capability;
	readonly handle: (
		context: KernelCapabilityContext,
		input: JsonValue,
	) => Effect.Effect<JsonValue, CapabilityFailure>;
};

const define = <S extends Schema.Codec<unknown, unknown>>(definition: {
	readonly input: S;
	readonly slug: string;
	readonly description: string;
	readonly hints: Capability["hints"];
	readonly output?: PluginOperationJsonSchema;
	readonly inputJson?: PluginOperationJsonSchema;
	readonly handle: (
		context: KernelCapabilityContext,
		input: S["Type"],
	) => Effect.Effect<unknown, CapabilityFailure>;
}): KernelCapabilityDefinition => ({
	capability: {
		hints: definition.hints,
		source: { kind: "kernel" },
		description: definition.description,
		id: kernelCapabilityId(definition.slug),
		output: definition.output ?? objectOutput,
		input: definition.inputJson ?? toAgentJsonSchema(definition.input),
	},
	handle: (context, raw) =>
		Schema.decodeEffect(definition.input, { onExcessProperty: "error" })(raw).pipe(
			Effect.mapError((error) => new BadRequest({ message: error.message })),
			Effect.flatMap((input) => definition.handle(context, input)),
			Effect.flatMap((value) => Schema.decodeUnknownEffect(JsonValue)(value).pipe(Effect.orDie)),
		),
});

export class KernelCapabilities extends Context.Service<KernelCapabilities>()(
	"@ryot-app/kernel-backend/modules/agent-tools/kernel-capabilities/KernelCapabilities",
	{
		make: Effect.gen(function* () {
			const pages = yield* PageAuthoringService;
			const views = yield* SavedViewsService;
			const ryotql = yield* RyotQLService;
			const definitions = yield* DefinitionRepository;
			const encodeResponse = Schema.encodeEffect(Schema.toCodecJson(RyotQLResponse));
			const execute = (
				context: KernelCapabilityContext,
				audience: "kernel" | "plugin",
				request: ExecutionRequest,
				document: RyotQLDocument,
			) =>
				boundedQuery(
					ryotql
						.executeForUser(
							context.user.id,
							context.user.preferences.language,
							audience,
							cappedRequest(request, document),
							context.accessClass,
							defaultResultByteBudget,
						)
						.pipe(Effect.flatMap(encodeResponse)),
				);
			const recipeRead =
				(document: RyotQLDocument) =>
				(context: KernelCapabilityContext, input: typeof ReadRequest.Type) =>
					decodeRequest({ ...input, source: { document, kind: "inline" } }).pipe(
						Effect.flatMap((request) => execute(context, "kernel", request, document)),
					);
			const describe = Effect.fn("KernelCapabilities.describe")(function* (userId: UserId) {
				const snapshot = yield* definitions.getUserSnapshot(userId, { listed: false });
				return yield* Schema.encodeEffect(Schema.toCodecJson(AgentDataDescription))({
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
				}).pipe(Effect.orDie);
			});
			const all = [
				define({
					hints: readHints,
					slug: "data.describe",
					input: Schema.Struct({}),
					handle: (context) => describe(context.user.id),
					description:
						"Describe the effective entity, event and relationship schemas, their properties and entity browse fields.",
				}),
				define({
					slug: "query",
					hints: readHints,
					output: ryotqlOutput,
					input: Schema.Record(Schema.String, JsonValue),
					description:
						"Execute an inline RyotQL request using plugin-readable tables and fields. Results are capped at 100 rows per query and a bounded JSON byte budget.",
					handle: (context, input) =>
						Effect.gen(function* () {
							const request = yield* decodeRequest(input);
							if (request.source.kind !== "inline") {
								return yield* new BadRequest({ message: "query requires an inline source" });
							}
							return yield* execute(context, "plugin", request, request.source.document);
						}),
					inputJson: {
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
				}),
				define({
					hints: readHints,
					output: ryotqlOutput,
					slug: "collections.list",
					input: Schema.Struct({ pages: Schema.optional(Pages) }),
					description: "List the user's collections with forward pagination.",
					handle: (context, input) =>
						decodeRequest({
							...input,
							source: { kind: "inline", document: allCollectionsRecipe.document },
						}).pipe(
							Effect.flatMap((request) =>
								execute(context, "plugin", request, allCollectionsRecipe.document),
							),
						),
				}),
				define({
					hints: readHints,
					input: QueryRequest,
					output: ryotqlOutput,
					slug: "collections.members",
					description:
						"Read members of an owned collection using its collectionId, optional searchText, and forward pagination.",
					inputJson: {
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
					handle: (context, input) =>
						Effect.gen(function* () {
							const bound = bindArguments(memberParameters, input.arguments);
							if (Result.isFailure(bound)) {
								return yield* new BadRequest({
									message: bound.failure.map(({ message }) => message).join("; "),
								});
							}
							const collectionId = bound.success["collectionId"];
							if (typeof collectionId !== "string") {
								return yield* new BadRequest({ message: "collectionId must be a string" });
							}
							const request = yield* decodeRequest({
								...input,
								arguments: { ...bound.success, ...collectionArguments(collectionId) },
								source: {
									kind: "inline",
									query: membersRecipe.query,
									document: membersRecipe.document,
								},
							});
							return yield* execute(context, "plugin", request, membersRecipe.document);
						}),
				}),
				define({
					hints: readHints,
					slug: "pages.list",
					input: ReadRequest,
					output: ryotqlOutput,
					handle: recipeRead(pagesRecipe.document),
					description: "List owned pages and their draft, compilation and publication identities.",
				}),
				define({
					hints: readHints,
					slug: "pages.get",
					input: ReadRequest,
					output: ryotqlOutput,
					handle: recipeRead(pageRecipe.document),
					description:
						"Read an owned page including draft and published source definitions. Supply arguments.pageId.",
				}),
				define({
					input: PageIdBody,
					hints: deleteHints,
					slug: "pages.delete",
					description: "Delete an owned page unless referenced by a view or publication.",
					handle: (context, input) =>
						pages.remove(context.user.id, input.pageId, context.idempotencyKey),
				}),
				define({
					hints: readHints,
					input: ReadRequest,
					output: ryotqlOutput,
					slug: "saved-views.list",
					handle: recipeRead(savedViewRecordsRecipe.document),
					description: "List owned effective saved views including renderer and query selections.",
				}),
				define({
					hints: readHints,
					input: ReadRequest,
					output: ryotqlOutput,
					slug: "saved-views.get",
					handle: recipeRead(savedViewRecordRecipe.document),
					description:
						"Read a saved view using arguments.referenceKind (custom, kernel or plugin), savedViewId for custom, slug for builtins, and pluginId for plugin builtins.",
				}),
				define({
					hints: writeHints,
					slug: "saved-views.create",
					input: CreateSavedViewBody,
					handle: (context, input) =>
						views.create(context.user, input, undefined, context.idempotencyKey),
					description:
						"Create a saved view; page renderers require a published owned page, null dataSources and empty settings.",
				}),
				define({
					hints: writeHints,
					slug: "saved-views.update",
					description: "Update a saved view by reference.",
					input: Schema.Struct({ body: UpdateSavedViewBody, reference: SavedViewReference }),
					handle: (context, input) =>
						views.update(context.user, input.reference, input.body, context.idempotencyKey),
				}),
				define({
					hints: deleteHints,
					slug: "saved-views.delete",
					description: "Delete a custom saved view by reference.",
					input: Schema.Struct({ reference: SavedViewReference }),
					handle: (context, input) =>
						views.delete(context.user, input.reference, context.idempotencyKey),
				}),
			];
			const byId = new Map<string, KernelCapabilityDefinition>(
				all.map((definition) => [definition.capability.id, definition]),
			);
			const handle = (id: string, context: KernelCapabilityContext, input: JsonValue) => {
				const definition = byId.get(id);
				return definition
					? definition.handle(context, input)
					: Effect.fail(new NotFound({ message: `Unknown capability: ${id}` }));
			};
			return { handle, capabilities: all.map((definition) => definition.capability) };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
