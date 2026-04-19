import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { BadRequest, NotFound, NotImplemented, Unauthorized } from "../../lib/errors";

const Pagination = Schema.Struct({ page: Schema.Number, limit: Schema.Number });

const DateRange = Schema.Struct({ endAt: Schema.String, startAt: Schema.String });

// Request bodies - full field/filter/sort schemas defined in Task 22 (Saved View Query Language Exports)
const EntitiesQueryRequest = Schema.Struct({
	mode: Schema.Literal("entities"),
	fields: Schema.Unknown,
	pagination: Pagination,
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(Schema.Unknown),
	filter: Schema.optional(Schema.Unknown),
	eventJoins: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
	relationshipJoins: Schema.optional(Schema.Unknown),
});

const EventsQueryRequest = Schema.Struct({
	mode: Schema.Literal("events"),
	fields: Schema.Unknown,
	pagination: Pagination,
	eventSchemas: Schema.Unknown,
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(Schema.Unknown),
	filter: Schema.optional(Schema.Unknown),
	eventJoins: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
});

const AggregateQueryRequest = Schema.Struct({
	mode: Schema.Literal("aggregate"),
	aggregations: Schema.Unknown,
	scope: Schema.Array(Schema.String),
	filter: Schema.optional(Schema.Unknown),
	eventJoins: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
	relationshipJoins: Schema.optional(Schema.Unknown),
});

const TimeSeriesQueryRequest = Schema.Struct({
	mode: Schema.Literal("timeSeries"),
	metric: Schema.Unknown,
	dateRange: DateRange,
	eventSchemas: Schema.Unknown,
	scope: Schema.Array(Schema.String),
	bucket: Schema.Literal("day", "hour", "month", "week"),
	filter: Schema.optional(Schema.Unknown),
	computedFields: Schema.optional(Schema.Unknown),
});

const QueryEngineRequest = Schema.Union(
	EntitiesQueryRequest,
	EventsQueryRequest,
	AggregateQueryRequest,
	TimeSeriesQueryRequest,
);

// Response bodies
const TableFieldValue = Schema.Struct({ kind: Schema.String, value: Schema.Unknown });

const TableMeta = Schema.Struct({
	pagination: Schema.Unknown,
	fieldOrder: Schema.Array(Schema.String),
});

const QueryEngineResponse = Schema.Union(
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
		mode: Schema.Literal("aggregate"),
		data: Schema.Struct({
			values: Schema.Array(
				Schema.Struct({ key: Schema.String, kind: Schema.String, value: Schema.Unknown }),
			),
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

export const QueryEngineGroup = HttpApiGroup.make("query-engine")
	.add(
		HttpApiEndpoint.post("execute", "/query-engine/execute")
			.setPayload(QueryEngineRequest)
			.addSuccess(QueryEngineResponse)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
