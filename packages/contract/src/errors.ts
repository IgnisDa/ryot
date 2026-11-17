import { isMessage, Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Effect, Predicate, Schema, SchemaIssue } from "effect";

import { StampedSandboxBoundaryReason } from "./modules/scripts/boundary-reason";
import { SANDBOX_FAILURE_KINDS } from "./modules/scripts/wire";

export const SandboxFailureKind = Schema.Literals([...SANDBOX_FAILURE_KINDS]);
export type SandboxFailureKind = typeof SandboxFailureKind.Type;

type PgErrorLike = {
	readonly code?: unknown;
	readonly table?: unknown;
	readonly column?: unknown;
	readonly constraint?: unknown;
};

export class DbError extends Schema.TaggedError<DbError, { readonly brand: unique symbol }>()(
	"DbError",
	{
		message: Schema.String,
		code: Schema.optional(Schema.String),
		table: Schema.optional(Schema.String),
		constraint: Schema.optional(Schema.String),
		columnName: Schema.optional(Schema.String),
	},
) {}

const pgStringField = (cause: unknown, field: keyof PgErrorLike) => {
	if (!cause || typeof cause !== "object") {
		return undefined;
	}
	const value: unknown = Reflect.get(cause, field);
	return typeof value === "string" ? value : undefined;
};

export const messageReasonOf = (error: unknown) =>
	Predicate.hasProperty(error, "reason") && isMessage(error.reason) ? error.reason : undefined;

export const unknownToMessage = (cause: unknown) =>
	messageReasonOf(cause)?.key ??
	(cause instanceof Error && typeof cause.message === "string" ? cause.message : String(cause));

export const unknownToDbError = (cause: unknown) =>
	new DbError({
		message: unknownToMessage(cause),
		...(pgStringField(cause, "code") ? { code: pgStringField(cause, "code") } : {}),
		...(pgStringField(cause, "table") ? { table: pgStringField(cause, "table") } : {}),
		...(pgStringField(cause, "column") ? { columnName: pgStringField(cause, "column") } : {}),
		...(pgStringField(cause, "constraint")
			? { constraint: pgStringField(cause, "constraint") }
			: {}),
	});

/** The field set of boundary errors: they only select an HTTP status, and `reason` is their text. */
export const contractErrorFields = { reason: Message };

export class Conflict extends Schema.TaggedError<Conflict, { readonly brand: unique symbol }>()(
	"Conflict",
	contractErrorFields,
) {}

export class NotFound extends Schema.TaggedError<NotFound, { readonly brand: unique symbol }>()(
	"NotFound",
	contractErrorFields,
) {}

export class BadRequest extends Schema.TaggedError<BadRequest, { readonly brand: unique symbol }>()(
	"BadRequest",
	contractErrorFields,
) {}

export class RateLimited extends Schema.TaggedError<
	RateLimited,
	{ readonly brand: unique symbol }
>()("RateLimited", contractErrorFields) {}

export class InternalError extends Schema.TaggedError<
	InternalError,
	{ readonly brand: unique symbol }
>()("InternalError", contractErrorFields) {}

export class SubmissionExpired extends Schema.TaggedError<
	SubmissionExpired,
	{ readonly brand: unique symbol }
>()("SubmissionExpired", contractErrorFields) {}

export const ValidationIssueCode = Schema.Literals([
	"forbidden",
	"invalid-type",
	"invalid-value",
	"missing-key",
	"one-of",
	"unexpected-key",
]);
export type ValidationIssueCode = typeof ValidationIssueCode.Type;

export const ValidationIssue = Schema.Struct({
	issue: ValidationIssueCode,
	path: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
});
export type ValidationIssue = typeof ValidationIssue.Type;

export class ValidationFailed extends Schema.TaggedError<
	ValidationFailed,
	{ readonly brand: unique symbol }
>()("ValidationFailed", { ...contractErrorFields, issues: Schema.Array(ValidationIssue) }) {}

const leafIssueCodes = {
	OneOf: "one-of",
	Forbidden: "forbidden",
	MissingKey: "missing-key",
	InvalidType: "invalid-type",
	InvalidValue: "invalid-value",
	UnexpectedKey: "unexpected-key",
} as const satisfies Record<SchemaIssue.Leaf["_tag"], ValidationIssueCode>;

const isValidationIssueCode = Schema.is(ValidationIssueCode);

const formatIssueCodes = SchemaIssue.makeFormatterStandardSchemaV1({
	checkHook: () => leafIssueCodes.InvalidValue,
	leafHook: (issue) => leafIssueCodes[issue._tag],
});

const pathSegment = (segment: PropertyKey | { readonly key: PropertyKey }) => {
	const key = typeof segment === "object" ? segment.key : segment;
	return typeof key === "symbol" ? String(key) : key;
};

export const validationFailed = (issues: ReadonlyArray<ValidationIssue>) =>
	new ValidationFailed({ issues, reason: kernelMessage("error.validation.invalid") });

export const schemaValidationFailed = (issue: SchemaIssue.Issue) =>
	validationFailed(
		formatIssueCodes(issue).issues.map((entry) => ({
			path: (entry.path ?? []).map(pathSegment),
			issue: isValidationIssueCode(entry.message) ? entry.message : leafIssueCodes.InvalidValue,
		})),
	);

export const conflict = (reason: Message) => new Conflict({ reason });
export const notFound = (reason: Message) => new NotFound({ reason });
export const badRequest = (reason: Message) => new BadRequest({ reason });
export const rateLimited = (reason: Message) => new RateLimited({ reason });
export const internalError = (reason: Message) => new InternalError({ reason });

export class SandboxRunError extends Schema.TaggedError<
	SandboxRunError,
	{ readonly brand: unique symbol }
>()("SandboxRunError", {
	message: Schema.String,
	kind: SandboxFailureKind,
	data: Schema.optional(StampedSandboxBoundaryReason),
}) {}

export const toSandboxRunError = (cause: unknown, kind: SandboxFailureKind): SandboxRunError =>
	cause instanceof SandboxRunError
		? cause
		: new SandboxRunError({ kind, message: unknownToMessage(cause) });

export class TimeoutError extends Schema.TaggedError<
	TimeoutError,
	{ readonly brand: unique symbol }
>()("TimeoutError", { message: Schema.String }) {}

// Unexpected database failures are not part of any route contract; convert them to
// defects so they surface as 500s without leaking PostgreSQL metadata to clients.
export const dieOnDbError = <A, E, R>(self: Effect.Effect<A, E, R>) =>
	self.pipe(
		Effect.catchIf(
			(error): error is Extract<E, DbError> => error instanceof DbError,
			(error) => Effect.die(error),
		),
	);

// Maps DbError to SandboxRunError without dying. Used in Activity.make where error
// type must be SandboxRunError rather than a defect. Other error types are also mapped.
export const mapDbErrorToSandbox = <A, E, R>(self: Effect.Effect<A, E, R>) =>
	self.pipe(
		Effect.mapError((error) =>
			error instanceof DbError
				? new SandboxRunError({ kind: "infrastructure", message: error.message })
				: toSandboxRunError(error, "script-failure"),
		),
	);
