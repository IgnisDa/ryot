import { Schema } from "effect";

import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { Filter, FilterField } from "../filters/schemas";
import { BrowseSort } from "../filters/sort";
import { PageDraftBuildIdentity } from "../pages/identity";
import { PluginPackageReference, SavedViewReference } from "../plugins/references";
import { PluginRyotQLDocument, RyotQLDocument, stampRyotQLDocument } from "./authored";
import { ParameterSchema } from "./parameters";

export const PagePreviewQuerySource = strictStruct({
	...PageDraftBuildIdentity.fields,
	query: Schema.NonEmptyString,
	kind: Schema.Literal("page-preview"),
});
export type PagePreviewQuerySource = typeof PagePreviewQuerySource.Type;

const executionSource = <Document extends Schema.Top>(document: Document) =>
	Schema.Union([
		PagePreviewQuerySource,
		strictStruct({
			document,
			kind: Schema.Literal("inline"),
			query: Schema.optional(Schema.NonEmptyString),
		}),
		strictStruct({
			query: Schema.NonEmptyString,
			reference: SavedViewReference,
			kind: Schema.Literal("savedView"),
		}),
		strictStruct({
			kind: Schema.Literal("plugin"),
			...PluginPackageReference.fields,
			query: Schema.NonEmptyString,
		}),
		strictStruct({
			kind: Schema.Literal("page"),
			query: Schema.NonEmptyString,
			pageId: Schema.NonEmptyString,
		}),
	]);

export const ExecutionSource = executionSource(RyotQLDocument);
export type ExecutionSource = typeof ExecutionSource.Type;

/** A source sent from plugin or kernel code, whose inline document the receiving side stamps. */
export const PluginExecutionSource = executionSource(PluginRyotQLDocument);
export type PluginExecutionSource = typeof PluginExecutionSource.Type;

export const stampExecutionSource = (
	namespace: string,
	source: PluginExecutionSource,
): ExecutionSource =>
	source.kind === "inline"
		? { ...source, document: stampRyotQLDocument(namespace, source.document) }
		: source;

export const QueryPage = strictStruct({
	after: Schema.optional(Schema.NonEmptyString),
	limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export const RequestValues = {
	filter: Schema.optional(Filter),
	sort: Schema.optional(Schema.NonEmptyString),
	pages: Schema.optional(Schema.Record(Schema.String, QueryPage)),
	arguments: Schema.optional(Schema.Record(Schema.String, JsonValue)),
};
export const ExecutionRequest = strictStruct({ source: ExecutionSource, ...RequestValues });
export type ExecutionRequest = typeof ExecutionRequest.Type;
export const PluginExecutionRequest = strictStruct({
	source: PluginExecutionSource,
	...RequestValues,
});
export type PluginExecutionRequest = typeof PluginExecutionRequest.Type;
export const VisitorRequest = strictStruct({ query: Schema.NonEmptyString, ...RequestValues });
export type VisitorRequest = typeof VisitorRequest.Type;
export const VisitorDescribeRequest = strictStruct({
	query: Schema.NonEmptyString,
	arguments: RequestValues.arguments,
});
export type VisitorDescribeRequest = typeof VisitorDescribeRequest.Type;
export const DescribeRequest = strictStruct({
	source: ExecutionSource,
	arguments: RequestValues.arguments,
});
export const PluginDescribeRequest = strictStruct({
	source: PluginExecutionSource,
	arguments: RequestValues.arguments,
});

export const DescribeResponse = strictStruct({
	parameters: ParameterSchema,
	filter: Schema.Array(FilterField),
	sort: Schema.Array(strictStruct({ key: Schema.NonEmptyString, ...BrowseSort.fields })),
});
