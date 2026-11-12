import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot-app/contract/errors";
import {
	CreatePageBody,
	PageDraftRevisionBody,
	PageIdBody,
	ReplacePageDraftBody,
} from "@ryot-app/contract/modules/pages/schemas";
import { PluginOperationJsonSchema } from "@ryot-app/contract/modules/plugins/manifest";
import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import {
	CreateSavedViewBody,
	UpdateSavedViewBody,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type { AgentToolDescriptor } from "@ryot-app/contract/schema/agent-tool";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { pageRecipe, pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import {
	savedViewRecordRecipe,
	savedViewRecordsRecipe,
} from "@ryot-app/ryotql-recipes/saved-view-records";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { PageAuthoringService } from "#modules/pages/authoring/service";
import { RyotQLService } from "#modules/ryotql/service";
import { SavedViewsService } from "#modules/saved-views/service";

const ReadRequest = Schema.Struct({
	arguments: Schema.optional(Schema.Record(Schema.String, JsonValue)),
	pages: Schema.optional(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				after: Schema.optional(Schema.NonEmptyString),
				limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
			}),
		),
	),
});
const UpdateView = Schema.Struct({ body: UpdateSavedViewBody, reference: SavedViewReference });
const Reference = Schema.Struct({ reference: SavedViewReference });
const readHints = { readOnly: true, idempotent: true, destructive: false };
const writeHints = { readOnly: false, idempotent: false, destructive: false };
const jsonSchema = (schema: Schema.Top) => {
	const json = Schema.toJsonSchemaDocument(schema);
	return Result.getOrThrow(
		Schema.decodeUnknownResult(PluginOperationJsonSchema)({
			...json.schema,
			$defs: json.definitions,
		}),
	);
};
const tool = (
	name: string,
	description: string,
	schema: Schema.Top,
	hints = writeHints,
): AgentToolDescriptor => ({
	name,
	hints,
	description,
	input: jsonSchema(schema),
	output: { type: "object" },
	source: { kind: "authoring" },
});
export const authoringTools: readonly AgentToolDescriptor[] = [
	tool(
		"page_list",
		"List owned pages and their draft, compilation and publication identities.",
		ReadRequest,
		readHints,
	),
	tool(
		"page_get",
		"Read an owned page including draft and published source definitions. Supply arguments.pageId.",
		ReadRequest,
		readHints,
	),
	tool("page_create", "Create a page draft without write access.", CreatePageBody),
	tool(
		"page_replace_draft",
		"Replace a revision-fenced page draft. Assistant edits revoke write access.",
		ReplacePageDraftBody,
	),
	tool(
		"page_compile",
		"Compile a draft; return its preview identity or typed build diagnostics.",
		PageDraftRevisionBody,
	),
	tool("page_publish", "Compile and publish the selected draft revision.", PageDraftRevisionBody),
	tool(
		"page_delete",
		"Delete an owned page unless referenced by a view or publication.",
		PageIdBody,
		{ ...writeHints, destructive: true },
	),
	tool(
		"saved_view_list",
		"List owned effective saved views including renderer and query selections.",
		ReadRequest,
		readHints,
	),
	tool(
		"saved_view_get",
		"Read a saved view using arguments.referenceKind (custom, kernel or plugin), savedViewId for custom, slug for builtins, and pluginId for plugin builtins.",
		ReadRequest,
		readHints,
	),
	tool(
		"saved_view_create",
		"Create a saved view; page renderers require a published owned page, null dataSources and empty settings.",
		CreateSavedViewBody,
	),
	tool("saved_view_update", "Update a saved view by reference.", UpdateView),
	tool("saved_view_delete", "Delete a custom saved view by reference.", Reference, {
		...writeHints,
		destructive: true,
	}),
];

export class AgentAuthoringTools extends Context.Service<AgentAuthoringTools>()(
	"@ryot-app/kernel-backend/modules/agent-tools/authoring/AgentAuthoringTools",
	{
		make: Effect.gen(function* () {
			const pages = yield* PageAuthoringService;
			const views = yield* SavedViewsService;
			const ryotql = yield* RyotQLService;
			const call = Effect.fn("AgentAuthoringTools.call")(function* (
				user: CurrentUserValue,
				name: string,
				args: JsonValue,
				idempotencyKey?: string,
				accessClass: "demo" | "standard" = "standard",
			) {
				const decode = <A, I>(schema: Schema.Codec<A, I>) =>
					Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(args).pipe(
						Effect.mapError((error) => new BadRequest({ message: error.message })),
					);
				const actor = { userId: user.id, kind: "assistant" as const };
				let value: unknown;
				switch (name) {
					case "page_get":
					case "page_list":
					case "saved_view_get":
					case "saved_view_list": {
						const input = yield* decode(ReadRequest);
						const documents = {
							page_get: pageRecipe.document,
							page_list: pagesRecipe.document,
							saved_view_get: savedViewRecordRecipe.document,
							saved_view_list: savedViewRecordsRecipe.document,
						};
						const document = documents[name];
						const result = yield* ryotql.executeForUser(
							user.id,
							user.preferences.language,
							"kernel",
							{ ...input, source: { document, kind: "inline" } },
							accessClass,
							65536,
						);
						return yield* Schema.encodeEffect(Schema.toCodecJson(RyotQLResponse))(result);
					}
					case "page_create":
						value = yield* pages.create(actor, yield* decode(CreatePageBody), idempotencyKey);
						break;
					case "page_delete":
						value = yield* pages.remove(
							user.id,
							(yield* decode(PageIdBody)).pageId,
							idempotencyKey,
						);
						break;
					case "page_compile":
						value = yield* pages.compile(
							user.id,
							yield* decode(PageDraftRevisionBody),
							idempotencyKey,
						);
						break;
					case "page_publish":
						value = yield* pages.publish(
							user.id,
							yield* decode(PageDraftRevisionBody),
							idempotencyKey,
						);
						break;
					case "saved_view_create":
						value = yield* views.create(
							user,
							yield* decode(CreateSavedViewBody),
							undefined,
							idempotencyKey,
						);
						break;
					case "saved_view_update": {
						const input = yield* decode(UpdateView);
						value = yield* views.update(user, input.reference, input.body, idempotencyKey);
						break;
					}
					case "saved_view_delete":
						value = yield* views.delete(user, (yield* decode(Reference)).reference, idempotencyKey);
						break;
					case "page_replace_draft":
						value = yield* pages.replaceDraft(
							actor,
							yield* decode(ReplacePageDraftBody),
							idempotencyKey,
						);
						break;
					default:
						return yield* new NotFound({ message: `Unknown authoring tool: ${name}` });
				}
				return yield* Schema.decodeUnknownEffect(JsonValue)(value).pipe(Effect.orDie);
			});
			return { call };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
