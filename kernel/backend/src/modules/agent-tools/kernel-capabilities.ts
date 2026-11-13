import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot-app/contract/errors";
import { PageIdBody } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginOperationJsonSchema } from "@ryot-app/contract/modules/plugins/manifest";
import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { argumentIssuesMessage, bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { ExecutionRequest, RequestValues } from "@ryot-app/contract/modules/ryotql/request";
import {
	CreateSavedViewBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { DiscoveryInput, toAgentJsonSchema } from "@ryot-app/contract/schema/agent-tool";
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
import { type QueryPaging, queryPaging } from "@ryot-app/ryotql/paging";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { PageAuthoringService } from "#modules/pages/authoring/service";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { defaultResultByteBudget } from "#platform/tool-result";

import { dataItems, describeData } from "./data-catalog";

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

const RequestInput = Schema.Struct(RequestValues);
const membersRecipe = collectionMembersRecipe();
const memberParameters = {
	fields: Object.fromEntries(
		Object.entries(membersRecipe.parameters.fields).filter(([key]) => key !== "source"),
	),
};

const agentPageLimit = 100;

const requestInput = (values: {
	readonly pages: PluginOperationJsonSchema;
	readonly arguments: PluginOperationJsonSchema;
}): Record<string, PluginOperationJsonSchema> => ({
	sort: { type: "string", description: "A sort choice key from the query's sort control" },
	filter: { type: "object", description: "A filter over the query's filter control fields" },
	...values,
});

const pageInput = (name: string, paging: QueryPaging): PluginOperationJsonSchema => {
	const maximum = Math.min(paging.maxLimit, agentPageLimit);
	return {
		type: "object",
		additionalProperties: false,
		description: `Page of '${name}': up to ${maximum} rows; pass the previous pageInfo.nextCursor as after`,
		properties: {
			after: { minLength: 1, type: "string" },
			limit: { maximum, minimum: 1, type: "integer" },
		},
	};
};

const pagesInput = (document: RyotQLDocument): PluginOperationJsonSchema => ({
	type: "object",
	additionalProperties: false,
	properties: Object.fromEntries(
		Object.entries(document.queries).flatMap(([name, query]) => {
			const paging = queryPaging(query);
			return paging === null ? [] : [[name, pageInput(name, paging)]];
		}),
	),
});

export const declaredQueryInput = (document: RyotQLDocument): PluginOperationJsonSchema => ({
	type: "object",
	additionalProperties: false,
	properties: requestInput({
		pages: pagesInput(document),
		arguments: appSchemaJsonSchema(document.parameters ?? { fields: {} }),
	}),
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
				const paging = queryPaging(query);
				if (
					paging === null ||
					(request.source.kind === "inline" &&
						request.source.query !== undefined &&
						request.source.query !== name)
				) {
					return [];
				}
				const requested = request.pages?.[name];
				return [
					[
						name,
						{
							...requested,
							limit: Math.min(requested?.limit ?? paging.limit, paging.maxLimit, agentPageLimit),
						},
					],
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
	readonly title: string;
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
		title: definition.title,
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
			const catalogs = yield* DefinitionCatalog;
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
			const recipeCapability = (definition: {
				readonly slug: string;
				readonly title: string;
				readonly description: string;
				readonly document: RyotQLDocument;
				readonly audience: "kernel" | "plugin";
			}) =>
				define({
					hints: readHints,
					input: RequestInput,
					output: ryotqlOutput,
					slug: definition.slug,
					title: definition.title,
					description: definition.description,
					inputJson: declaredQueryInput(definition.document),
					handle: (context, input) =>
						decodeRequest({
							...input,
							source: { kind: "inline", document: definition.document },
						}).pipe(
							Effect.flatMap((request) =>
								execute(context, definition.audience, request, definition.document),
							),
						),
				});
			const describe = Effect.fn("KernelCapabilities.describe")(function* (
				userId: UserId,
				input: DiscoveryInput,
			) {
				const snapshot = yield* definitions.getUserSnapshot(userId, { listed: false });
				const { plugins } = yield* catalogs.forUser(userId);
				return describeData(
					dataItems(
						snapshot,
						new Map(plugins.map((plugin) => [plugin.pluginId, plugin.packageId])),
					),
					input,
				);
			});
			const all = [
				define({
					hints: readHints,
					slug: "data.describe",
					input: DiscoveryInput,
					title: "Describe data",
					handle: (context, input) => describe(context.user.id, input),
					description:
						'Find the data RyotQL documents read: kernel:tables/<name> query tables with their fields, <owner>:entities/<slug> entity schemas with their properties and events, and <owner>:relationships/<slug> relationship schemas. Without a query it lists namespaces. Detail "names" returns IDs, "summary" (default) adds field and property names, "full" adds kinds and property schemas.',
				}),
				define({
					slug: "query",
					hints: readHints,
					title: "Run a query",
					output: ryotqlOutput,
					input: Schema.Record(Schema.String, JsonValue),
					description: `Execute an inline RyotQL request using plugin-readable tables and fields. Results are capped at ${agentPageLimit} rows per query and a bounded JSON byte budget.`,
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
							...requestInput({
								arguments: { type: "object" },
								pages: {
									type: "object",
									description: `Pages by query name, each { after?: string, limit?: 1 to ${agentPageLimit} }`,
								},
							}),
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
				recipeCapability({
					audience: "plugin",
					slug: "collections.list",
					title: "List collections",
					document: allCollectionsRecipe.document,
					description: "List the user's collections with forward pagination.",
				}),
				define({
					hints: readHints,
					input: RequestInput,
					output: ryotqlOutput,
					slug: "collections.members",
					title: "Read collection members",
					description:
						"Read members of an owned collection using its collectionId, optional searchText, and forward pagination.",
					inputJson: {
						type: "object",
						required: ["arguments"],
						additionalProperties: false,
						properties: requestInput({
							pages: pagesInput(membersRecipe.document),
							arguments: appSchemaJsonSchema(memberParameters),
						}),
					},
					handle: (context, input) =>
						Effect.gen(function* () {
							const bound = bindArguments(memberParameters, input.arguments);
							if (Result.isFailure(bound)) {
								return yield* new BadRequest({ message: argumentIssuesMessage(bound.failure) });
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
				recipeCapability({
					audience: "kernel",
					slug: "pages.list",
					title: "List pages",
					document: pagesRecipe.document,
					description: "List owned pages and their draft, compilation and publication identities.",
				}),
				recipeCapability({
					slug: "pages.get",
					audience: "kernel",
					title: "Read page",
					document: pageRecipe.document,
					description: "Read an owned page including draft and published source definitions.",
				}),
				define({
					input: PageIdBody,
					hints: deleteHints,
					slug: "pages.delete",
					title: "Delete page",
					description: "Delete an owned page unless referenced by a view or publication.",
					handle: (context, input) =>
						pages.remove(context.user.id, input.pageId, context.idempotencyKey),
				}),
				recipeCapability({
					audience: "kernel",
					slug: "saved-views.list",
					title: "List saved views",
					document: savedViewRecordsRecipe.document,
					description: "List owned effective saved views including renderer and query selections.",
				}),
				recipeCapability({
					audience: "kernel",
					slug: "saved-views.get",
					title: "Read saved view",
					document: savedViewRecordRecipe.document,
					description:
						"Read a saved view using arguments.referenceKind (custom, kernel or plugin), savedViewId for custom, slug for builtins, and pluginId for plugin builtins.",
				}),
				define({
					hints: writeHints,
					slug: "saved-views.create",
					title: "Create saved view",
					input: CreateSavedViewBody,
					handle: (context, input) =>
						views.create(context.user, input, undefined, context.idempotencyKey),
					description:
						"Create a saved view; page renderers require a published owned page, null dataSources and empty settings.",
				}),
				define({
					hints: writeHints,
					slug: "saved-views.update",
					title: "Update saved view",
					description: "Update a saved view by reference.",
					input: Schema.Struct({ body: UpdateSavedViewBody, reference: SavedViewReference }),
					handle: (context, input) =>
						views.update(context.user, input.reference, input.body, context.idempotencyKey),
				}),
				define({
					hints: deleteHints,
					slug: "saved-views.delete",
					title: "Delete saved view",
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
