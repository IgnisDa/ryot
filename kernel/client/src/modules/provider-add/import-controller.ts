import {
	type ImportEntityRunResult,
	ProviderEntityImportBacklogFull,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect, Match, Result, Schema } from "effect";

import { ProviderAddLoadError } from "#/modules/provider-add/service";

const PROVIDER_IMPORT_POLL_ATTEMPTS = 60;

const PROVIDER_IMPORT_POLL_INTERVAL = "2 seconds";

export const PROVIDER_IMPORT_FAILED_MESSAGE =
	"The provider could not import this item. Try again later.";

export const PROVIDER_IMPORT_CANCELLED_MESSAGE = "The import was cancelled.";

export const PROVIDER_IMPORT_UNAVAILABLE_MESSAGE =
	"The import could not be started. Check your connection and try again.";

export const PROVIDER_IMPORT_BACKLOG_FULL_MESSAGE =
	"You have too many imports waiting. Try again once some of them finish.";

export const PROVIDER_IMPORT_TIMEOUT_MESSAGE =
	"The import is taking longer than expected. Check your library in a few minutes.";

export type ProviderEntityImportEntry =
	| { readonly status: "idle" }
	| { readonly status: "queued" }
	| { readonly status: "importing" }
	| { readonly status: "failed"; readonly message: string }
	| { readonly status: "imported"; readonly entityId: EntityId };

export type ProviderEntityImportState = ReadonlyMap<string, ProviderEntityImportEntry>;

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

/** Only running polls count toward the timeout, because a queued import waits for other imports. */
const pollProviderEntityImport = Effect.fnUntraced(function* (
	poll: (jobId: string) => Effect.Effect<ImportEntityRunResult, unknown>,
	jobId: string,
	onProgress: (entry: ProviderEntityImportEntry) => void,
) {
	let runningPolls = 0;
	for (;;) {
		const result = yield* Effect.result(poll(jobId));
		if (Result.isFailure(result)) {
			return failedEntry(PROVIDER_IMPORT_UNAVAILABLE_MESSAGE);
		}
		const entry = providerEntityImportOutcome(result.success);
		if (entry.status !== "queued" && entry.status !== "importing") {
			return entry;
		}
		if (entry.status === "importing") {
			runningPolls += 1;
			if (runningPolls > PROVIDER_IMPORT_POLL_ATTEMPTS) {
				return failedEntry(PROVIDER_IMPORT_TIMEOUT_MESSAGE);
			}
		}
		onProgress(entry);
		yield* Effect.sleep(PROVIDER_IMPORT_POLL_INTERVAL);
	}
});

export const importProviderEntity = (input: {
	readonly start: Effect.Effect<{ readonly jobId: string }, unknown>;
	readonly poll: (jobId: string) => Effect.Effect<ImportEntityRunResult, unknown>;
	readonly onProgress: (entry: ProviderEntityImportEntry) => void;
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
