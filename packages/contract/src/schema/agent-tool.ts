import { Effect, Result, Schema, SchemaGetter, SchemaIssue } from "effect";
import { Base64 } from "effect/encoding";

import {
	ClientRendererFile,
	PageDefinition,
	PageDraftRevisionBody,
	PagePluginQueries,
} from "../modules/pages/schemas";
import { PluginOperationHints, PluginOperationJsonSchema } from "../modules/plugins/manifest";
import { strictStruct } from "./utils";

const optionalInput = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));

export const AgentToolName = Schema.Literals([
	"search",
	"execute",
	"read_docs",
	"page_read",
	"page_edit",
	"page_write",
	"page_publish",
]);
export type AgentToolName = typeof AgentToolName.Type;

export const DiscoveryInput = strictStruct({
	query: optionalInput(Schema.String),
	namespace: optionalInput(Schema.NonEmptyString),
	detail: optionalInput(Schema.Literals(["names", "summary", "full"])),
	limit: optionalInput(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type DiscoveryInput = typeof DiscoveryInput.Type;
export const ExecuteInput = strictStruct({ code: Schema.NonEmptyString });
export const ReadDocsInput = strictStruct({
	topic: optionalInput(Schema.NonEmptyString),
	page: optionalInput(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type ReadDocsInput = typeof ReadDocsInput.Type;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const PageWriteFile = strictStruct({ path: Schema.String, text: Schema.String }).pipe(
	Schema.decodeTo(ClientRendererFile, {
		decode: SchemaGetter.transform(({ path, text }) => ({ path, content: Base64.encode(text) })),
		encode: SchemaGetter.transformEffect(({ path, content }) =>
			Effect.try({
				try: () => ({ path, text: utf8.decode(Result.getOrThrow(Base64.decode(content))) }),
				catch: () =>
					new SchemaIssue.InvalidValue({ message: `${path} is not UTF-8 text` }, content),
			}),
		),
	}),
);

export const PageWriteInput = strictStruct({
	name: optionalInput(Schema.NonEmptyString),
	slug: optionalInput(Schema.NonEmptyString),
	pageId: optionalInput(Schema.NonEmptyString),
	expectedDraftRevision: optionalInput(Schema.Int.check(Schema.isGreaterThan(0))),
	definition: strictStruct({ ...PageDefinition.fields, files: Schema.Array(PageWriteFile) }),
});
export type PageWriteInput = typeof PageWriteInput.Type;
export const PAGE_READ_MAX_LINES = 2_000;
export const PageReadInput = strictStruct({
	pageId: Schema.NonEmptyString,
	path: optionalInput(Schema.NonEmptyString),
	offset: optionalInput(Schema.Int.check(Schema.isGreaterThan(0))),
	limit: optionalInput(
		Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: PAGE_READ_MAX_LINES })),
	),
});
export type PageReadInput = typeof PageReadInput.Type;
const PageEditChange = Schema.Union([
	strictStruct({
		newText: Schema.String,
		path: Schema.NonEmptyString,
		oldText: Schema.NonEmptyString,
		replaceAll: optionalInput(Schema.Boolean),
	}),
	strictStruct({ text: Schema.String, path: Schema.NonEmptyString }),
	strictStruct({ path: Schema.NonEmptyString, delete: Schema.Literal(true) }),
]);
export const PageEditInput = strictStruct({
	...PageDraftRevisionBody.fields,
	edits: Schema.Array(PageEditChange),
	pluginQueries: optionalInput(PagePluginQueries),
	entry: optionalInput(PageDefinition.fields.entry),
	queries: optionalInput(PageDefinition.fields.queries),
	pluginDependencies: optionalInput(PageDefinition.fields.pluginDependencies),
});
export type PageEditInput = typeof PageEditInput.Type;
export const PagePublishInput = PageDraftRevisionBody;

export const AgentToolDescriptor = strictStruct({
	name: AgentToolName,
	description: Schema.String,
	hints: PluginOperationHints,
	title: Schema.NonEmptyString,
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
		title: "Publish page",
		input: toAgentJsonSchema(PagePublishInput),
		description: "Publish a compiled page draft revision.",
	},
	read_docs: {
		hints: readHints,
		approval: "none",
		name: "read_docs",
		title: "Read docs",
		input: toAgentJsonSchema(ReadDocsInput),
		description:
			"Read Ryot documentation. Without a topic it lists topics. Long topics are split into pages, starting at 1. Read the pages topic before writing a page.",
	},
	page_read: {
		hints: readHints,
		approval: "none",
		name: "page_read",
		title: "Read a page draft",
		input: toAgentJsonSchema(PageReadInput),
		description:
			"Read a page's current draft. Without a path it returns the draft revision, entry, queries, dependencies and the list of files with their line counts. With a path it returns that file's numbered lines from offset (1-based, default 1), up to limit lines (default and maximum 2000).",
	},
	search: {
		name: "search",
		hints: readHints,
		approval: "none",
		title: "Search capabilities",
		input: toAgentJsonSchema(DiscoveryInput),
		description:
			'Find Ryot capabilities: data schemas and queries, collections, pages, saved views and installed plugin operations and queries. Without a query it lists namespaces. Detail "names" returns IDs, "summary" (default) adds descriptions and hints, "full" adds the TypeScript input and output types used by execute.',
	},
	page_write: {
		approval: "none",
		hints: writeHints,
		name: "page_write",
		title: "Write a page draft",
		input: toAgentJsonSchema(PageWriteInput),
		description:
			"Create a page draft (name, slug, definition) or replace a whole one (pageId, expectedDraftRevision, definition), then compile it. Give each file as { path, text } with its UTF-8 source. Prefer page_edit for changes to an existing draft. Returns the draft preview identity, or compiler diagnostics to repair before writing again.",
	},
	execute: {
		name: "execute",
		title: "Run a script",
		approval: "per-write",
		input: toAgentJsonSchema(ExecuteInput),
		hints: { readOnly: false, idempotent: false, destructive: true },
		description:
			'Run TypeScript in a sandbox. `code` is the body of an async function with `ryot` in scope. Call capabilities with `await ryot.call(id, input)` and `return` a JSON result, for example `return await ryot.call("kernel:collections.list", {});`. Reads run immediately. Writes the user has not allowed in advance ask for approval, and throw when declined or not allowed. There is no network, import or timer access. Type errors are reported before anything runs.',
	},
	page_edit: {
		approval: "none",
		hints: writeHints,
		name: "page_edit",
		title: "Edit a page draft",
		input: toAgentJsonSchema(PageEditInput),
		description:
			"Change a page draft without resending it, then compile it. Each edit is { path, oldText, newText } to replace text that occurs exactly once (or every occurrence with replaceAll), { path, text } to create or overwrite a file, or { path, delete: true } to remove a file. Edits apply in order. entry, queries, pluginDependencies and pluginQueries replace those definition fields when given. Returns the draft preview identity, or compiler diagnostics with the new draftRevision to repair with another edit.",
	},
};
