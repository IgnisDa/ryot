import { Result, Schema } from "effect";

import { PageDefinition, PageDraftRevisionBody } from "../modules/pages/schemas";
import { PluginOperationHints, PluginOperationJsonSchema } from "../modules/plugins/manifest";
import { strictStruct } from "./utils";

export const AgentToolName = Schema.Literals([
	"search",
	"execute",
	"read_docs",
	"page_write",
	"page_publish",
]);
export type AgentToolName = typeof AgentToolName.Type;

export const SearchCapabilitiesInput = strictStruct({
	query: Schema.optional(Schema.String),
	namespace: Schema.optional(Schema.NonEmptyString),
	detail: Schema.optional(Schema.Literals(["names", "summary", "full"])),
	limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type SearchCapabilitiesInput = typeof SearchCapabilitiesInput.Type;
export const ExecuteInput = strictStruct({ code: Schema.NonEmptyString });
export const ReadDocsInput = strictStruct({
	topic: Schema.optional(Schema.NonEmptyString),
	page: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type ReadDocsInput = typeof ReadDocsInput.Type;
export const PageWriteInput = strictStruct({
	definition: PageDefinition,
	name: Schema.optional(Schema.NonEmptyString),
	slug: Schema.optional(Schema.NonEmptyString),
	pageId: Schema.optional(Schema.NonEmptyString),
	expectedDraftRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type PageWriteInput = typeof PageWriteInput.Type;
export const PagePublishInput = PageDraftRevisionBody;

export const AgentToolDescriptor = strictStruct({
	name: AgentToolName,
	description: Schema.String,
	hints: PluginOperationHints,
	input: PluginOperationJsonSchema,
	approval: Schema.Literals(["none", "call", "per-write"]),
});
export type AgentToolDescriptor = typeof AgentToolDescriptor.Type;

export const toAgentJsonSchema = (schema: Schema.Top) => {
	const json = Schema.toJsonSchemaDocument(schema);
	return Result.getOrThrow(
		Schema.decodeUnknownResult(PluginOperationJsonSchema)({
			...json.schema,
			...(Object.keys(json.definitions).length > 0 ? { $defs: json.definitions } : {}),
		}),
	);
};
const readHints = { readOnly: true, idempotent: true, destructive: false };
const writeHints = { readOnly: false, idempotent: false, destructive: false };

export const agentTools: { readonly [Name in AgentToolName]: AgentToolDescriptor } = {
	page_publish: {
		approval: "call",
		hints: writeHints,
		name: "page_publish",
		input: toAgentJsonSchema(PagePublishInput),
		description: "Publish a compiled page draft revision.",
	},
	read_docs: {
		hints: readHints,
		approval: "none",
		name: "read_docs",
		input: toAgentJsonSchema(ReadDocsInput),
		description:
			"Read Ryot documentation. Without a topic it lists topics. Long topics are split into pages, starting at 1. Read the pages topic before writing a page.",
	},
	page_write: {
		approval: "call",
		hints: writeHints,
		name: "page_write",
		input: toAgentJsonSchema(PageWriteInput),
		description:
			"Create a page draft (name, slug, definition) or replace one (pageId, expectedDraftRevision, definition), then compile it. Returns the draft preview identity, or compiler diagnostics to repair before writing again.",
	},
	search: {
		name: "search",
		hints: readHints,
		approval: "none",
		input: toAgentJsonSchema(SearchCapabilitiesInput),
		description:
			'Find Ryot capabilities: data schemas and queries, collections, pages, saved views and installed plugin operations and queries. Without a query it lists namespaces. Detail "names" returns IDs, "summary" (default) adds descriptions and hints, "full" adds the TypeScript input and output types used by execute.',
	},
	execute: {
		name: "execute",
		approval: "per-write",
		input: toAgentJsonSchema(ExecuteInput),
		hints: { readOnly: false, idempotent: false, destructive: true },
		description:
			'Run TypeScript in a sandbox. `code` is the body of an async function with `ryot` in scope. Call capabilities with `await ryot.call(id, input)` and `return` a JSON result, for example `return await ryot.call("kernel:collections.list", {});`. Reads run immediately. Every write asks the user for approval and throws when declined. There is no network, import or timer access. Type errors are reported before anything runs.',
	},
};
