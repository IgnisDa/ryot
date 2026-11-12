import { Schema } from "effect";

import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { Filter, FilterField } from "../filters/schemas";
import { BrowseSort } from "../filters/sort";
import { PageDraftBuildIdentity } from "../pages/identity";
import { PluginPackageReference, SavedViewReference } from "../plugins/references";
import { RyotQLDocument } from "./authored";
import { ParameterSchema } from "./parameters";

export const PagePreviewQuerySource = strictStruct({
	...PageDraftBuildIdentity.fields,
	query: Schema.NonEmptyString,
	kind: Schema.Literal("page-preview"),
});
export type PagePreviewQuerySource = typeof PagePreviewQuerySource.Type;

export const ExecutionSource = Schema.Union([
	PagePreviewQuerySource,
	strictStruct({
		document: RyotQLDocument,
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
export type ExecutionSource = typeof ExecutionSource.Type;
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

export const DescribeResponse = strictStruct({
	parameters: ParameterSchema,
	filter: Schema.Array(FilterField),
	sort: Schema.Array(strictStruct({ key: Schema.NonEmptyString, ...BrowseSort.fields })),
});
