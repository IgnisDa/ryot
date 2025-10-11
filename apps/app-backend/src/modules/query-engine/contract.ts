import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, NotFound, RateLimited, Unauthorized } from "#lib/errors";
import { DateRange, PaginationResult, QueryEngineRequest } from "#lib/query-language";

const TableFieldValue = Schema.Struct({
	value: Schema.Unknown,
	kind: Schema.Literal("boolean", "date", "image", "json", "null", "number", "text"),
});

const AggregateFieldValue = Schema.Union(
	Schema.Struct({ key: Schema.String, kind: Schema.Literal("null"), value: Schema.Unknown }),
	Schema.Struct({ key: Schema.String, kind: Schema.Literal("number"), value: Schema.Number }),
	Schema.Struct({
		key: Schema.String,
		kind: Schema.Literal("json"),
		value: Schema.Record({ key: Schema.String, value: Schema.Number }),
	}),
);

const TableMeta = Schema.Struct({
	pagination: PaginationResult,
	fieldOrder: Schema.Array(Schema.String),
});

const QueryEngineResponse = Schema.Union(
	Schema.Struct({
		mode: Schema.Literal("aggregate"),
		data: Schema.Struct({ values: Schema.Array(AggregateFieldValue) }),
	}),
	Schema.Struct({
		mode: Schema.Literal("entities"),
		data: Schema.Struct({
			meta: TableMeta,
			items: Schema.Array(Schema.Record({ key: Schema.String, value: TableFieldValue })),
		}),
	}),
	Schema.Struct({
		mode: Schema.Literal("events"),
		data: Schema.Struct({
			meta: TableMeta,
			items: Schema.Array(Schema.Record({ key: Schema.String, value: TableFieldValue })),
		}),
	}),
	Schema.Struct({
		mode: Schema.Literal("timeSeries"),
		data: Schema.Struct({
			buckets: Schema.Array(Schema.Struct({ date: Schema.String, value: Schema.Number })),
			meta: Schema.Struct({ alignedDateRange: DateRange }),
		}),
	}),
);

export const QueryEngineGroup = HttpApiGroup.make("queryEngine")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("execute", "/query-engine/execute")
			.setPayload(QueryEngineRequest)
			.addSuccess(QueryEngineResponse)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 }),
	);
