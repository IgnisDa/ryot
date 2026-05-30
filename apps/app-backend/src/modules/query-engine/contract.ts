import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, NotFound, RateLimited, Unauthorized } from "#lib/errors";
import { DateRange, PaginationResult, QueryEngineRequest } from "#lib/query-language";

const TableFieldValue = Schema.Struct({
	value: Schema.Unknown,
	kind: Schema.Literal("boolean", "date", "image", "json", "null", "number", "text"),
});

const NullAggregateFieldValue = Schema.Struct({
	key: Schema.String,
	kind: Schema.Literal("null"),
	value: Schema.Unknown,
}).pipe(
	Schema.annotations({
		identifier: "NullAggregateFieldValue",
		title: "Null Aggregate Field Value",
	}),
);

const NumberAggregateFieldValue = Schema.Struct({
	key: Schema.String,
	kind: Schema.Literal("number"),
	value: Schema.Number,
}).pipe(
	Schema.annotations({
		identifier: "NumberAggregateFieldValue",
		title: "Number Aggregate Field Value",
	}),
);

const JsonAggregateFieldValue = Schema.Struct({
	key: Schema.String,
	kind: Schema.Literal("json"),
	value: Schema.Record({ key: Schema.String, value: Schema.Number }),
}).pipe(
	Schema.annotations({
		identifier: "JsonAggregateFieldValue",
		title: "Json Aggregate Field Value",
	}),
);

const AggregateFieldValue = Schema.Union(
	NullAggregateFieldValue,
	NumberAggregateFieldValue,
	JsonAggregateFieldValue,
);

const TableMeta = Schema.Struct({
	pagination: PaginationResult,
	fieldOrder: Schema.Array(Schema.String),
});

const AggregateQueryEngineResponse = Schema.Struct({
	mode: Schema.Literal("aggregate"),
	data: Schema.Struct({ values: Schema.Array(AggregateFieldValue) }),
}).pipe(
	Schema.annotations({
		identifier: "AggregateQueryEngineResponse",
		title: "Aggregate Query Response",
	}),
);

const EntitiesQueryEngineResponse = Schema.Struct({
	mode: Schema.Literal("entities"),
	data: Schema.Struct({
		meta: TableMeta,
		items: Schema.Array(Schema.Record({ key: Schema.String, value: TableFieldValue })),
	}),
}).pipe(
	Schema.annotations({
		identifier: "EntitiesQueryEngineResponse",
		title: "Entities Query Response",
	}),
);

const EventsQueryEngineResponse = Schema.Struct({
	mode: Schema.Literal("events"),
	data: Schema.Struct({
		meta: TableMeta,
		items: Schema.Array(Schema.Record({ key: Schema.String, value: TableFieldValue })),
	}),
}).pipe(
	Schema.annotations({ identifier: "EventsQueryEngineResponse", title: "Events Query Response" }),
);

const TimeSeriesQueryEngineResponse = Schema.Struct({
	mode: Schema.Literal("timeSeries"),
	data: Schema.Struct({
		buckets: Schema.Array(Schema.Struct({ date: Schema.String, value: Schema.Number })),
		meta: Schema.Struct({ alignedDateRange: DateRange }),
	}),
}).pipe(
	Schema.annotations({
		identifier: "TimeSeriesQueryEngineResponse",
		title: "Time Series Query Response",
	}),
);

const QueryEngineResponse = Schema.Union(
	AggregateQueryEngineResponse,
	EntitiesQueryEngineResponse,
	EventsQueryEngineResponse,
	TimeSeriesQueryEngineResponse,
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
