import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { BadRequest, NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";
import { DateRange, QueryEngineRequest } from "../../lib/query-language";

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
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.post("execute", "/query-engine/execute")
			.setPayload(QueryEngineRequest)
			.addSuccess(QueryEngineResponse)
			.addError(BadRequest, { status: 400 })
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
