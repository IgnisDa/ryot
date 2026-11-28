import { CommitConflictCode } from "@ryot-app/contract/modules/changes/change-set";
import { Message } from "@ryot-app/i18n/message";
import { RyotClientErrorReason } from "@ryot-app/plugin-client-contract";
import { Effect, Schema } from "effect";

const carriesDetail = Schema.makeFilter(
	(error: { readonly reason: RyotClientErrorReason }) =>
		(error.reason !== "operation-rejected" || "rejection" in error) &&
		(error.reason !== "changes-conflict" || "conflict" in error),
	{ message: "A rejection or conflict is an OperationRejected or a ChangesConflict" },
);

export class RyotClientError extends Schema.TaggedError<
	RyotClientError,
	{ readonly brand: unique symbol }
>()("RyotClientError", Schema.Struct({ reason: RyotClientErrorReason }).check(carriesDetail)) {}

/** The write conflicted with a newer one; `conflict` is the commit's conflict code. */
export class ChangesConflict extends RyotClientError.extend<ChangesConflict>("ChangesConflict")({
	conflict: CommitConflictCode,
	reason: Schema.Literal("changes-conflict").pipe(
		Schema.withConstructorDefault(Effect.succeed("changes-conflict" as const)),
	),
}) {}

/** An operation refused the request; `rejection` is the plugin's explanation. */
export class OperationRejected extends RyotClientError.extend<OperationRejected>(
	"OperationRejected",
)({
	rejection: Message,
	reason: Schema.Literal("operation-rejected").pipe(
		Schema.withConstructorDefault(Effect.succeed("operation-rejected" as const)),
	),
}) {}

export const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError({ reason: "transport" });

export const isEntitlementRequired = (error: unknown) =>
	error instanceof RyotClientError && error.reason === "entitlement-required";

export const isOperationRejected = (error: unknown): error is OperationRejected =>
	error instanceof OperationRejected;

export const isChangesConflict = (error: unknown): error is ChangesConflict =>
	error instanceof ChangesConflict;
