import type { ImportEntityRunResult } from "@ryot/contract/modules/provider-entities/schemas";
import type { EntityId } from "@ryot/contract/schema/brands";
import { Effect, Match, Schedule } from "effect";

const PROVIDER_IMPORT_POLL_ATTEMPTS = 60;

const PROVIDER_IMPORT_POLL_INTERVAL = "2 seconds";

export const PROVIDER_IMPORT_FAILED_MESSAGE =
	"The provider could not import this item. Try again later.";

export const PROVIDER_IMPORT_UNAVAILABLE_MESSAGE =
	"The import could not be started. Check your connection and try again.";

export const PROVIDER_LIBRARY_ADD_FAILED_MESSAGE =
	"The item was imported but could not be added to your library. Try again.";

export const PROVIDER_IMPORT_TIMEOUT_MESSAGE =
	"The import is taking longer than expected. Check your library in a few minutes.";

const providerEntityImportPollSchedule = Schedule.spaced(PROVIDER_IMPORT_POLL_INTERVAL).pipe(
	Schedule.upTo({ times: PROVIDER_IMPORT_POLL_ATTEMPTS }),
);

export type ProviderEntityImportEntry =
	| { readonly status: "idle" }
	| { readonly status: "importing" }
	| { readonly status: "failed"; readonly message: string }
	| { readonly status: "imported"; readonly entityId: EntityId };

export type ProviderEntityImportState = ReadonlyMap<string, ProviderEntityImportEntry>;

const providerEntityImportPending = { reason: "pending" } as const;

const failedEntry = (message: string) => ({ status: "failed", message }) as const;

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
		Match.when({ status: "pending" }, () => undefined),
		Match.when({ status: "failed" }, () => failedEntry(PROVIDER_IMPORT_FAILED_MESSAGE)),
		Match.when(
			{ status: "completed" },
			(completed) => ({ status: "imported", entityId: completed.data.id }) as const,
		),
		Match.exhaustive,
	);

const pollProviderEntityImport = (
	poll: (jobId: string) => Effect.Effect<ImportEntityRunResult, unknown>,
	jobId: string,
) =>
	poll(jobId).pipe(
		Effect.map(providerEntityImportOutcome),
		Effect.catch(() => Effect.succeed(failedEntry(PROVIDER_IMPORT_UNAVAILABLE_MESSAGE))),
		Effect.flatMap((entry) =>
			entry === undefined ? Effect.fail(providerEntityImportPending) : Effect.succeed(entry),
		),
		Effect.retry(providerEntityImportPollSchedule),
		Effect.catch(() => Effect.succeed(failedEntry(PROVIDER_IMPORT_TIMEOUT_MESSAGE))),
	);

export const importProviderEntity = (input: {
	readonly start: Effect.Effect<{ readonly jobId: string }, unknown>;
	readonly poll: (jobId: string) => Effect.Effect<ImportEntityRunResult, unknown>;
	readonly onImported?: ((entityId: EntityId) => Effect.Effect<void, unknown>) | undefined;
}) =>
	Effect.gen(function* () {
		const started = yield* input.start.pipe(Effect.catch(() => Effect.succeed(undefined)));
		if (started === undefined) {
			return failedEntry(PROVIDER_IMPORT_UNAVAILABLE_MESSAGE);
		}
		const entry = yield* pollProviderEntityImport(input.poll, started.jobId);
		if (entry.status === "imported" && input.onImported !== undefined) {
			return yield* input.onImported(entry.entityId).pipe(
				Effect.match({
					onSuccess: () => entry,
					onFailure: () => failedEntry(PROVIDER_LIBRARY_ADD_FAILED_MESSAGE),
				}),
			);
		}
		return entry;
	});
