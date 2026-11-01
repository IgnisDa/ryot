import {
	type ImportEntityRunResult,
	ProviderEntityImportBacklogFull,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { Clock, Duration, Effect, Match, Option, Result, Schema } from "effect";

import { ProviderAddLoadError } from "#/modules/provider-add/service";

const PROVIDER_IMPORT_TIMEOUT_MILLIS = 120_000;

export const PROVIDER_IMPORT_FAILED_MESSAGE =
	"The provider could not import this item. Try again later.";

export const PROVIDER_IMPORT_CANCELLED_MESSAGE = "The import was cancelled.";

export const PROVIDER_IMPORT_UNAVAILABLE_MESSAGE =
	"The import could not be started. Check your connection and try again.";

export const PROVIDER_IMPORT_BACKLOG_FULL_MESSAGE =
	"You have too many imports waiting. Try again once some of them finish.";

export const PROVIDER_IMPORT_TIMEOUT_MESSAGE =
	"The import is taking longer than expected. Check your library in a few minutes.";

export type ProviderEntityImportState = ReadonlyMap<string, ProviderEntityImportEntry>;

export type ProviderEntityImportEntry =
	| { readonly status: "idle" }
	| { readonly status: "queued" }
	| { readonly status: "importing" }
	| { readonly message: string; readonly status: "failed" }
	| { readonly status: "imported"; readonly entityId: EntityId };

const failedEntry = (message: string) => ({ message, status: "failed" }) as const;

export const createProviderEntityImportState = (): ProviderEntityImportState => new Map();

export const providerEntityImportEntry = (
	state: ProviderEntityImportState,
	externalId: string,
): ProviderEntityImportEntry => state.get(externalId) ?? { status: "idle" };

export const setProviderEntityImportEntry = (
	state: ProviderEntityImportState,
	externalId: string,
	entry: ProviderEntityImportEntry,
): ProviderEntityImportState => new Map(state).set(externalId, entry);

const providerEntityImportOutcome = (result: ImportEntityRunResult) =>
	Match.value(result).pipe(
		Match.when({ status: "queued" }, () => ({ status: "queued" }) as const),
		Match.when({ status: "running" }, () => ({ status: "importing" }) as const),
		Match.when({ status: "cancelled" }, () => failedEntry(PROVIDER_IMPORT_CANCELLED_MESSAGE)),
		Match.when({ status: "failed" }, () => failedEntry(PROVIDER_IMPORT_FAILED_MESSAGE)),
		Match.when(
			{ status: "completed" },
			(completed) => ({ status: "imported", entityId: completed.data.id }) as const,
		),
		Match.exhaustive,
	);

const isBacklogFull = (error: unknown) =>
	Schema.is(ProviderEntityImportBacklogFull)(
		error instanceof ProviderAddLoadError ? error.cause : error,
	);

const pollProviderEntityImport = Effect.fnUntraced(function* (
	poll: (jobId: string) => Effect.Effect<ImportEntityRunResult, ProviderAddLoadError>,
	jobId: string,
	onProgress: (entry: ProviderEntityImportEntry) => void,
) {
	let runningElapsedMillis = 0;
	let runningSinceNanos: bigint | undefined;
	const elapsedAt = (nanos: bigint) =>
		runningElapsedMillis +
		(runningSinceNanos === undefined ? 0 : Number(nanos - runningSinceNanos) / 1_000_000);
	for (;;) {
		const elapsedMillis = elapsedAt(yield* Clock.monotonicTimeNanos);
		const polling =
			runningSinceNanos === undefined
				? poll(jobId).pipe(Effect.asSome)
				: poll(jobId).pipe(
						Effect.timeoutOption(Duration.millis(PROVIDER_IMPORT_TIMEOUT_MILLIS - elapsedMillis)),
					);
		const result = yield* Effect.result(polling);
		const observedAtNanos = yield* Clock.monotonicTimeNanos;
		if (
			runningSinceNanos !== undefined &&
			elapsedAt(observedAtNanos) >= PROVIDER_IMPORT_TIMEOUT_MILLIS
		) {
			return failedEntry(PROVIDER_IMPORT_TIMEOUT_MESSAGE);
		}
		if (Result.isFailure(result)) {
			return failedEntry(PROVIDER_IMPORT_UNAVAILABLE_MESSAGE);
		}
		if (Option.isNone(result.success)) {
			return failedEntry(PROVIDER_IMPORT_TIMEOUT_MESSAGE);
		}
		const entry = providerEntityImportOutcome(result.success.value);
		if (entry.status !== "queued" && entry.status !== "importing") {
			return entry;
		}
		if (entry.status === "importing") {
			runningSinceNanos ??= observedAtNanos;
		} else if (runningSinceNanos !== undefined) {
			runningElapsedMillis = elapsedAt(observedAtNanos);
			runningSinceNanos = undefined;
		}
		onProgress(entry);
	}
});

export const importProviderEntity = (input: {
	readonly onProgress: (entry: ProviderEntityImportEntry) => void;
	readonly start: Effect.Effect<{ readonly jobId: string }, ProviderAddLoadError>;
	readonly poll: (jobId: string) => Effect.Effect<ImportEntityRunResult, ProviderAddLoadError>;
}) =>
	Effect.gen(function* () {
		const started = yield* Effect.result(input.start);
		if (Result.isFailure(started)) {
			return failedEntry(
				isBacklogFull(started.failure)
					? PROVIDER_IMPORT_BACKLOG_FULL_MESSAGE
					: PROVIDER_IMPORT_UNAVAILABLE_MESSAGE,
			);
		}
		return yield* pollProviderEntityImport(input.poll, started.success.jobId, input.onProgress);
	});
