import type {
	ClientPageOperationTarget,
	PreparedClientPage,
} from "@ryot-app/contract/modules/pages/schemas";
import {
	BACKGROUND_SUBMISSION_LIMITS,
	type BackgroundSubmissionFailureClass,
	type BackgroundSubmissionOutcome,
	type PluginBackgroundOperationRequest,
	type PluginOperationRequest,
} from "@ryot-app/plugin-client-contract";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { Cause, Clock, Context, Effect, Exit, type Fiber, Layer } from "effect";

import type { ApiScope } from "#/api/scope";
import { oauthTokenSessionKey } from "#/modules/auth/token-identity";
import { OAuthTokenService } from "#/modules/auth/token-service";
import {
	type PluginOperationDispatchOutcome,
	PluginOperationsService,
} from "#/modules/pages/bridge/operations";

export const SUCCESS_DISMISS_MS = 6_000;
export const ANNOUNCEMENT_INTERVAL_MS = 2_000;

export type BackgroundSubmissionState =
	| { readonly status: "pending" }
	| { readonly status: "succeeded" }
	| { readonly status: "incomplete"; readonly count: number | undefined }
	| {
			readonly status: "failed";
			readonly reason: Exclude<BackgroundSubmissionFailureClass, "operation-rejected">;
	  }
	| { readonly status: "failed"; readonly message: string; readonly reason: "operation-rejected" };

export type BackgroundSubmissionEntry = {
	readonly id: string;
	readonly label: string;
	readonly pluginName: string;
	readonly installationId: string;
	readonly transportSeen: boolean;
	readonly state: BackgroundSubmissionState;
};

export type BackgroundSubmissionSnapshot = {
	readonly announcement: string;
	readonly entries: readonly BackgroundSubmissionEntry[];
};

export type BackgroundSubmissionTarget = ClientPageOperationTarget & {
	readonly pluginName: string;
};

export type BackgroundSubmissionReservation = {
	readonly submissionId: string;
	readonly start: () => void;
	readonly cancel: () => void;
};

export type BackgroundSubmissionBinding = {
	readonly session: object;
	readonly settle: (submissionId: string, outcome: BackgroundSubmissionOutcome) => void;
};

type SubmissionRecord = {
	readonly id: string;
	readonly session: object;
	readonly target: BackgroundSubmissionTarget;
	readonly request: PluginOperationRequest;
	readonly label: string;
	readonly settle: BackgroundSubmissionBinding["settle"];
	reserved: boolean;
	transportSeen: boolean;
	state: BackgroundSubmissionState;
	fiber: Fiber.Fiber<unknown, unknown> | undefined;
};

const retryableReasons: ReadonlySet<BackgroundSubmissionFailureClass> =
	new Set<BackgroundSubmissionFailureClass>(["transport", "malformed-result"]);

export const isRetryable = (state: BackgroundSubmissionState) =>
	state.status === "incomplete" ||
	(state.status === "failed" && retryableReasons.has(state.reason));

export const resolveBackgroundSubmissionTarget = (
	identity: Pick<PreparedClientPage["identity"], "contributors" | "operationTargets">,
	catalog: PluginClientCatalog,
	packageId: string,
): BackgroundSubmissionTarget | undefined => {
	const target = identity.operationTargets.find((candidate) => candidate.packageId === packageId);
	const contributor = identity.contributors.find(
		(candidate) =>
			candidate.kind === "plugin" &&
			candidate.packageId === packageId &&
			candidate.installationId === target?.installationId &&
			candidate.pluginId === target.pluginId,
	);
	const plugin = catalog.find((entry) => entry.installationId === target?.installationId);
	return target === undefined || contributor === undefined || plugin === undefined
		? undefined
		: { ...target, pluginName: plugin.name };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const settledState = (outcome: PluginOperationDispatchOutcome): BackgroundSubmissionState => {
	if (outcome.outcome === "stale-session") {
		return { status: "failed", reason: "app-updated" };
	}
	if (outcome.outcome === "failure") {
		return outcome.reason === "operation-rejected"
			? { status: "failed", message: outcome.message, reason: "operation-rejected" }
			: { status: "failed", reason: outcome.reason };
	}
	if (isRecord(outcome.value) && outcome.value.status === "incomplete") {
		const { count } = outcome.value;
		return {
			status: "incomplete",
			count: typeof count === "number" && Number.isFinite(count) ? count : undefined,
		};
	}
	return { status: "succeeded" };
};

const wireOutcome = (state: BackgroundSubmissionState): BackgroundSubmissionOutcome | undefined => {
	if (state.status === "pending") {
		return undefined;
	}
	if (state.status !== "failed") {
		return { status: state.status };
	}
	return state.reason === "operation-rejected"
		? { status: "failed", message: state.message, reason: "operation-rejected" }
		: { status: "failed", reason: state.reason };
};

const failureStatus = {
	"operation-failed": "Not saved",
	"app-updated": "Ryot was updated",
	"operation-rejected": "Not saved",
	transport: "Couldn't confirm it was saved",
	"malformed-result": "Unexpected server response",
} as const satisfies Record<BackgroundSubmissionFailureClass, string>;

const settledStatus = {
	succeeded: "Saved",
	pending: "Saving…",
	incomplete: "Partly saved",
} as const;

export const backgroundSubmissionStatus = ({ state }: BackgroundSubmissionEntry): string =>
	state.status === "failed" ? failureStatus[state.reason] : settledStatus[state.status];

const announcementText = (entry: BackgroundSubmissionEntry) =>
	`${entry.pluginName}: ${entry.label}. ${backgroundSubmissionStatus(entry)}.`;

export type BackgroundSubmissionTray = {
	readonly getSnapshot: () => BackgroundSubmissionSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly reserve: (submission: {
		readonly target: BackgroundSubmissionTarget;
		readonly binding: BackgroundSubmissionBinding;
		readonly request: PluginBackgroundOperationRequest;
	}) => BackgroundSubmissionReservation | undefined;
	readonly retry: (id: string, catalog: PluginClientCatalog) => boolean;
	readonly dismiss: (id: string) => void;
	readonly dispose: () => void;
};

export class BackgroundSubmissionService extends Context.Service<BackgroundSubmissionService>()(
	"BackgroundSubmissionService",
	{
		make: Effect.gen(function* () {
			const operations = yield* PluginOperationsService;
			const tokens = yield* OAuthTokenService;

			const open = Effect.fn("BackgroundSubmissionService.open")(function* (options: {
				readonly scope: ApiScope;
				readonly onSucceeded: () => void;
			}) {
				const context = yield* Effect.context();
				const runFork = Effect.runForkWith(context);
				const now = () => Effect.runSyncWith(context)(Clock.currentTimeMillis);
				const authorization = tokens.authorization.forServer(options.scope.serverUrl);
				let login = authorization.current;
				let loginSession = oauthTokenSessionKey(login.tokens);
				let disposed = false;
				const records = new Map<string, SubmissionRecord>();
				const timers = new Set<Fiber.Fiber<unknown, unknown>>();
				const listeners = new Set<() => void>();
				let announcement = "";
				let announcedAt: number | undefined;
				let queued: string[] = [];
				let announcing: Fiber.Fiber<unknown, unknown> | undefined;
				let snapshot: BackgroundSubmissionSnapshot = { entries: [], announcement };

				const toEntry = (record: SubmissionRecord): BackgroundSubmissionEntry => ({
					id: record.id,
					state: record.state,
					label: record.label,
					transportSeen: record.transportSeen,
					pluginName: record.target.pluginName,
					installationId: record.target.installationId,
				});
				const publish = () => {
					snapshot = {
						announcement,
						entries: [...records.values()].filter((record) => !record.reserved).map(toEntry),
					};
					for (const listener of listeners) {
						listener();
					}
				};
				const schedule = (delayMs: number, run: () => void) => {
					const fiber: Fiber.Fiber<void> = runFork(
						Effect.sleep(delayMs).pipe(
							Effect.andThen(Effect.sync(run)),
							Effect.ensuring(Effect.sync(() => timers.delete(fiber))),
						),
					);
					timers.add(fiber);
					return fiber;
				};
				const flushAnnouncements = () => {
					announcing = undefined;
					if (queued.length === 0) {
						return;
					}
					announcement =
						queued.length === 1
							? (queued[0] ?? "")
							: `${queued.length} background updates. Latest: ${queued.at(-1) ?? ""}`;
					queued = [];
					announcedAt = now();
					publish();
				};
				const announce = (record: SubmissionRecord) => {
					queued.push(announcementText(toEntry(record)));
					if (announcing !== undefined) {
						return;
					}
					const wait =
						announcedAt === undefined
							? 0
							: Math.max(0, announcedAt + ANNOUNCEMENT_INTERVAL_MS - now());
					if (wait === 0) {
						flushAnnouncements();
						return;
					}
					announcing = schedule(wait, flushAnnouncements);
				};
				const inFlight = (session?: object) =>
					[...records.values()].filter(
						(record) =>
							record.state.status === "pending" &&
							(session === undefined || record.session === session),
					).length;
				const settle = (record: SubmissionRecord, state: BackgroundSubmissionState) => {
					record.fiber = undefined;
					record.state = state;
					if (state.status === "failed" && state.reason === "transport") {
						record.transportSeen = true;
					}
					const outcome = wireOutcome(state);
					if (outcome !== undefined) {
						try {
							record.settle(record.id, outcome);
						} catch {
							/* Delivery to a departed document is best effort. */
						}
					}
					if (state.status === "succeeded" || state.status === "incomplete") {
						options.onSucceeded();
					}
					if (state.status === "succeeded") {
						schedule(SUCCESS_DISMISS_MS, () => {
							if (records.get(record.id)?.state.status === "succeeded") {
								records.delete(record.id);
								publish();
							}
						});
					}
					announce(record);
					publish();
				};
				const attempt = (record: SubmissionRecord) => {
					record.state = { status: "pending" };
					record.fiber = runFork(
						operations
							.invoke({
								scope: options.scope,
								request: record.request,
								contentHash: record.target.contentHash,
							})
							.pipe(
								Effect.onExit((exit) =>
									Effect.sync(() => {
										if (Exit.isSuccess(exit)) {
											settle(record, settledState(exit.value));
										} else if (!Cause.hasInterruptsOnly(exit.cause)) {
											settle(record, { status: "failed", reason: "transport" });
										}
									}),
								),
							),
					);
				};
				const clear = () => {
					for (const record of records.values()) {
						record.fiber?.interruptUnsafe();
					}
					for (const timer of timers) {
						timer.interruptUnsafe();
					}
					records.clear();
					timers.clear();
					queued = [];
					announcing = undefined;
					announcement = "";
					announcedAt = undefined;
					publish();
				};
				const syncLogin = () => {
					if (authorization.isCurrent(login)) {
						return;
					}
					login = authorization.current;
					const next = oauthTokenSessionKey(login.tokens);
					if (next !== loginSession) {
						loginSession = next;
						clear();
					}
				};
				const releaseLogin = authorization.store.subscribe(syncLogin);
				const admit = () => {
					if (records.size < BACKGROUND_SUBMISSION_LIMITS.entries) {
						return true;
					}
					const evictable = [...records.values()].find(
						(record) => !record.reserved && record.state.status === "succeeded",
					);
					if (evictable === undefined) {
						return false;
					}
					records.delete(evictable.id);
					return true;
				};

				const tray: BackgroundSubmissionTray = {
					getSnapshot: () => snapshot,
					subscribe: (listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					dispose: () => {
						if (disposed) {
							return;
						}
						disposed = true;
						releaseLogin();
						clear();
						listeners.clear();
					},
					dismiss: (id) => {
						const record = records.get(id);
						if (record !== undefined && !record.reserved && record.state.status !== "pending") {
							records.delete(id);
							publish();
						}
					},
					retry: (id, catalog) => {
						const record = records.get(id);
						if (
							record === undefined ||
							!isRetryable(record.state) ||
							inFlight() >= BACKGROUND_SUBMISSION_LIMITS.inFlightPerService ||
							!catalog.some(
								({ pluginId, installationId }) =>
									installationId === record.target.installationId &&
									pluginId === record.target.pluginId,
							)
						) {
							return false;
						}
						attempt(record);
						announce(record);
						publish();
						return true;
					},
					reserve: ({ target, binding, request }) => {
						syncLogin();
						if (
							disposed ||
							inFlight() >= BACKGROUND_SUBMISSION_LIMITS.inFlightPerService ||
							inFlight(binding.session) >= BACKGROUND_SUBMISSION_LIMITS.inFlightPerSession ||
							!admit()
						) {
							return undefined;
						}
						const record: SubmissionRecord = {
							target,
							reserved: true,
							fiber: undefined,
							label: request.label,
							transportSeen: false,
							settle: binding.settle,
							id: crypto.randomUUID(),
							session: binding.session,
							state: { status: "pending" },
							request: {
								input: request.input,
								packageId: request.packageId,
								operationSlug: request.operationSlug,
								idempotencyKey: request.idempotencyKey,
							},
						};
						records.set(record.id, record);
						publish();
						return {
							submissionId: record.id,
							cancel: () => {
								if (records.get(record.id) === record && record.reserved) {
									records.delete(record.id);
									publish();
								}
							},
							start: () => {
								if (records.get(record.id) !== record || !record.reserved) {
									return;
								}
								record.reserved = false;
								attempt(record);
								announce(record);
								publish();
							},
						};
					},
				};
				return tray;
			});

			return { open };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
