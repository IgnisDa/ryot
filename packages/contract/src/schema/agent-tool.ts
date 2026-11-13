import { Effect, Result, Schema, SchemaGetter, SchemaIssue } from "effect";
import { Base64 } from "effect/encoding";

import {
	ClientRendererFile,
	PageDefinition,
	PageDraftRevisionBody,
} from "../modules/pages/schemas";
import { PluginOperationHints, PluginOperationJsonSchema } from "../modules/plugins/manifest";
import { strictStruct } from "./utils";

const optionalInput = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));

export const AgentToolName = Schema.Literals([
	"search",
	"execute",
	"read_docs",
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
	page_write: {
		approval: "none",
		hints: writeHints,
		name: "page_write",
		title: "Write a page draft",
		input: toAgentJsonSchema(PageWriteInput),
		description:
			"Create a page draft (name, slug, definition) or replace one (pageId, expectedDraftRevision, definition), then compile it. Give each file as { path, text } with its UTF-8 source. Returns the draft preview identity, or compiler diagnostics to repair before writing again.",
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
	execute: {
		name: "execute",
		title: "Run a script",
		approval: "per-write",
		input: toAgentJsonSchema(ExecuteInput),
		hints: { readOnly: false, idempotent: false, destructive: true },
		description:
			'Run TypeScript in a sandbox. `code` is the body of an async function with `ryot` in scope. Call capabilities with `await ryot.call(id, input)` and `return` a JSON result, for example `return await ryot.call("kernel:collections.list", {});`. Reads run immediately. Writes the user has not allowed in advance ask for approval, and throw when declined or not allowed. There is no network, import or timer access. Type errors are reported before anything runs.',
	},
};
