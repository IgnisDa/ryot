import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { AuthMiddleware } from "../../lib/auth";
import { DbError, PatternsDuplicateItem, PatternsRejected, Unauthorized } from "../../lib/errors";
import {
	DbTransactionPayload,
	FilterConditionPayload,
	FilterResult,
	RunUniqueConstraintPayload,
	PatternsResult,
	UniqueConstraintResult,
} from "./schemas";

export const PatternsGroup = HttpApiGroup.make("patterns")
	.add(
		HttpApiEndpoint.post("dbTransaction", "/patterns/db-transaction")
			.setPayload(DbTransactionPayload)
			.addSuccess(PatternsResult, { status: 201 })
			.addError(Unauthorized, { status: 401 })
			.addError(PatternsRejected, { status: 422 })
			.addError(DbError, { status: 500 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("uniqueConstraint", "/patterns/unique-constraint")
			.setPayload(RunUniqueConstraintPayload)
			.addSuccess(UniqueConstraintResult, { status: 201 })
			.addError(Unauthorized, { status: 401 })
			.addError(PatternsDuplicateItem, { status: 409 })
			.addError(DbError, { status: 500 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("filterCondition", "/patterns/filter-condition")
			.setPayload(FilterConditionPayload)
			.addSuccess(FilterResult, { status: 201 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.annotate(
		OpenApi.Description,
		"Reference patterns: transaction, constraint, and recursive schema demos",
	);
