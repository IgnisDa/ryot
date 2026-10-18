import {
	RyotClientError,
	type ManagedAssetLocator,
	type RyotClient,
	type RyotSchedule,
} from "@ryot-app/plugin-client-sdk";
import { Effect, Semaphore } from "@ryot-app/plugin-client-sdk/effect";
import type {
	PluginDeviceRequest,
	PluginDeviceResult,
	PluginId,
	PluginNavigationTarget,
} from "@ryot-app/plugin-client-sdk/plugin";

import type { WorkoutEditorContextOutputSchema } from "../../shared/workout-editor-context-operations";
import {
	decodeWorkoutEditorDraft,
	encodeWorkoutEditorDraft,
	type WorkoutEditorDraft,
} from "../../shared/workout-editor-draft";
import type {
	WorkoutEditorSaveInput,
	WorkoutEditorSaveOutput,
} from "../../shared/workout-editor-operations";
import { completeWorkoutSet } from "./actions";
import {
	attachDraftMedia,
	draftMedia,
	sameMedia,
	targetMedia,
	type WorkoutMediaKind,
	type WorkoutMediaTarget,
} from "./media-state";
import { invalidateWorkoutCountdowns, reconcileWorkoutTimers } from "./timers";

type WorkoutEditorContext = typeof WorkoutEditorContextOutputSchema.Type;
type TimerName = "execution" | "rest";
type TimerSnapshot = {
	readonly clientId: string;
	readonly deadline: string;
	readonly key: string;
	readonly audible: boolean;
};

type ContextSnapshot = {
	readonly context: WorkoutEditorContext | undefined;
	readonly contextError: unknown;
};

type WorkoutEditorControllerSnapshot =
	| (ContextSnapshot & { readonly status: "loading" })
	| (ContextSnapshot & { readonly status: "empty" })
	| (ContextSnapshot & {
			readonly error: unknown;
			readonly rawValue: unknown;
			readonly status: "recovery-error";
	  })
	| (ContextSnapshot & {
			readonly alertStatus: Readonly<Partial<Record<TimerName, PluginDeviceResult["status"]>>>;
			readonly deviceError: unknown;
			readonly dirty: boolean;
			readonly draft: WorkoutEditorDraft;
			readonly persistenceError: unknown;
			readonly saving: boolean;
			readonly uploading: boolean;
			readonly uploadError?: unknown;
			readonly status: "ready";
			readonly timerError: unknown;
	  });

type WorkoutEditorControllerPorts = {
	readonly foreground: () => boolean;
	readonly upload?: RyotClient["uploads"]["uploadPermanent"];
	readonly cleanup?: RyotClient["uploads"]["cleanup"];
	readonly device?:
		| ((request: PluginDeviceRequest) => Effect.Effect<PluginDeviceResult, unknown>)
		| undefined;
	readonly now: Effect.Effect<number, unknown>;
	readonly pluginId?: PluginId | undefined;
	readonly refreshContext?: Effect.Effect<WorkoutEditorContext, unknown> | undefined;
	readonly schedule?: Pick<RyotSchedule, "after" | "run"> | undefined;
	readonly storage: {
		readonly read: Effect.Effect<unknown, unknown>;
		readonly remove: Effect.Effect<void, unknown>;
		readonly write: (value: string) => Effect.Effect<void, unknown>;
	};
	readonly target?: PluginNavigationTarget | undefined;
	readonly feedback?: (() => Effect.Effect<void>) | undefined;
};

type WorkoutEditorController = {
	readonly uploadMedia: (
		target: WorkoutMediaTarget,
		kind: WorkoutMediaKind,
		file: File,
	) => Effect.Effect<void, unknown>;
	readonly beginSubmission: (
		input: WorkoutEditorSaveInput,
	) => Effect.Effect<WorkoutEditorSaveInput, unknown>;
	readonly change: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => boolean;
	readonly discard: () => Effect.Effect<boolean, unknown>;
	readonly dispose: () => void;
	readonly finish: () => Effect.Effect<boolean, unknown>;
	readonly flush: () => Effect.Effect<void, unknown>;
	readonly getSnapshot: () => WorkoutEditorControllerSnapshot;
	readonly load: () => Effect.Effect<void, unknown>;
	readonly reconcile: (expected?: {
		readonly executionClientId?: string;
		readonly restClientId?: string;
	}) => Effect.Effect<void, unknown>;
	readonly refreshContext: () => Effect.Effect<void, unknown>;
	readonly rejectSubmission: (result: WorkoutEditorSaveOutput) => Effect.Effect<boolean, unknown>;
	readonly setSaving: (saving: boolean) => void;
	readonly start: (draft: WorkoutEditorDraft) => Effect.Effect<boolean, unknown>;
	readonly subscribe: (listener: () => void) => () => void;
};

const initialSnapshot: WorkoutEditorControllerSnapshot = {
	status: "loading",
	context: undefined,
	contextError: undefined,
};

const isReady = (
	snapshot: WorkoutEditorControllerSnapshot,
): snapshot is Extract<WorkoutEditorControllerSnapshot, { readonly status: "ready" }> =>
	snapshot.status === "ready";

const isRecoveryError = (
	snapshot: WorkoutEditorControllerSnapshot,
): snapshot is Extract<WorkoutEditorControllerSnapshot, { readonly status: "recovery-error" }> =>
	snapshot.status === "recovery-error";

const alertKey = (draftId: string, timer: TimerName) =>
	`fitness-workout-editor:${draftId}:${timer}`;

export const createWorkoutEditorController = (
	ports: WorkoutEditorControllerPorts,
): WorkoutEditorController => {
	const listeners = new Set<() => void>();
	const loadSemaphore = Semaphore.makeUnsafe(1);
	const persistenceSemaphore = Semaphore.makeUnsafe(1);
	const mediaSemaphore = Semaphore.makeUnsafe(1);
	const timerCallbacks = new Map<
		TimerName,
		{ readonly cancel: () => void; readonly snapshot: TimerSnapshot }
	>();
	const scheduledAlerts = new Map<TimerName, TimerSnapshot>();
	let snapshot: WorkoutEditorControllerSnapshot = initialSnapshot;
	let loaded = false;
	let loadFailed = false;
	let revision = 0;
	let persistedRevision = 0;
	let flushRunning = false;
	let discarding = false;
	let disposed = false;
	let shortcutSet: boolean | undefined;
	let firstSubmissionAttempt = false;
	let canReleaseRejection = false;

	const publish = (next: WorkoutEditorControllerSnapshot) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};

	const getSnapshot = () => snapshot;
	const isEmpty = () => getSnapshot().status === "empty";
	const canDiscard = () => isReady(snapshot) || isRecoveryError(snapshot);
	const isDisposed = () => disposed;

	const updateReady = (
		update: (
			current: Extract<WorkoutEditorControllerSnapshot, { readonly status: "ready" }>,
		) => Extract<WorkoutEditorControllerSnapshot, { readonly status: "ready" }>,
	) => {
		if (isReady(snapshot)) {
			publish(update(snapshot));
		}
	};

	const setContextFailure = (error: unknown) => {
		publish({ ...snapshot, contextError: error });
	};

	const runDevice = (
		request: PluginDeviceRequest,
	): Effect.Effect<PluginDeviceResult | undefined> =>
		ports.device === undefined
			? Effect.as(Effect.void, undefined)
			: Effect.match(ports.device(request), {
					onSuccess: (result) => result,
					onFailure: (error) => {
						updateReady((current) => ({ ...current, deviceError: error }));
						return undefined;
					},
				});

	const syncShortcut = (draft: WorkoutEditorDraft | undefined) => {
		const pluginId = ports.pluginId;
		const target = ports.target;
		if (ports.device === undefined || pluginId === undefined || target === undefined) {
			return Effect.void;
		}
		const shouldSet = draft?.mode.kind === "live" && draft.endedAt === undefined;
		if (shouldSet === shortcutSet) {
			return Effect.void;
		}
		const request: PluginDeviceRequest = {
			pluginId,
			action: "return-shortcut",
			shortcut: shouldSet ? { target, label: "Resume workout" } : null,
		};
		return Effect.tap(runDevice(request), (result) =>
			Effect.sync(() => {
				if (result !== undefined && result.status !== "denied" && result.status !== "unsupported") {
					shortcutSet = shouldSet;
				}
			}),
		);
	};

	const desiredTimer = (draft: WorkoutEditorDraft, timer: TimerName): TimerSnapshot | undefined => {
		const countdown = timer === "execution" ? draft.executionCountdown : draft.restCountdown;
		if (countdown === undefined || countdown.pausedRemainingSeconds !== undefined) {
			return undefined;
		}
		return {
			clientId: countdown.clientId,
			deadline: countdown.deadline,
			key: alertKey(draft.draftId, timer),
			audible: !(
				draft.localPreferences?.muteSounds ??
				snapshot.context?.settings.muteSounds ??
				false
			),
		};
	};

	const scheduleTimerCallbacks = (draft: WorkoutEditorDraft) =>
		disposed
			? Effect.void
			: Effect.match(ports.now, {
					onFailure: (error) => {
						updateReady((current) => ({ ...current, timerError: error }));
						return undefined;
					},
					onSuccess: (now) => {
						for (const timer of ["execution", "rest"] as const) {
							const wanted = desiredTimer(draft, timer);
							const current = timerCallbacks.get(timer);
							if (
								wanted !== undefined &&
								current !== undefined &&
								current.snapshot.clientId === wanted.clientId &&
								current.snapshot.deadline === wanted.deadline
							) {
								continue;
							}
							current?.cancel();
							timerCallbacks.delete(timer);
							if (wanted === undefined || ports.schedule === undefined) {
								continue;
							}
							const expected =
								timer === "execution"
									? { executionClientId: wanted.clientId }
									: { restClientId: wanted.clientId };
							const schedule = ports.schedule;
							const cancel = schedule.after(Math.max(0, Date.parse(wanted.deadline) - now), () =>
								schedule.run(Effect.ignore(reconcile(expected)), () => undefined),
							);
							timerCallbacks.set(timer, { cancel, snapshot: wanted });
						}
						return undefined;
					},
				});

	const syncAlerts = (draft: WorkoutEditorDraft | undefined, removedDraftId?: string) => {
		const pluginId = ports.pluginId;
		const target = ports.target;
		if (ports.device === undefined || pluginId === undefined) {
			return Effect.void;
		}
		return Effect.gen(function* () {
			for (const timer of ["execution", "rest"] as const) {
				const wanted = draft === undefined ? undefined : desiredTimer(draft, timer);
				const current = scheduledAlerts.get(timer);
				if (wanted === undefined) {
					let stableKey: string | undefined;
					if (draft !== undefined) {
						stableKey = alertKey(draft.draftId, timer);
					} else if (removedDraftId !== undefined) {
						stableKey = alertKey(removedDraftId, timer);
					}
					for (const key of new Set([current?.key, stableKey])) {
						if (key === undefined) {
							continue;
						}
						const cancelled = yield* runDevice({ key, pluginId, action: "cancel" });
						if (cancelled !== undefined && cancelled.status !== "denied") {
							scheduledAlerts.delete(timer);
						}
					}
					continue;
				}
				if (current !== undefined && current.key !== wanted.key) {
					const cancelled = yield* runDevice({ pluginId, key: current.key, action: "cancel" });
					if (cancelled !== undefined && cancelled.status !== "denied") {
						scheduledAlerts.delete(timer);
					}
				}
				if (target === undefined) {
					continue;
				}
				const prior = scheduledAlerts.get(timer);
				if (
					prior?.key === wanted.key &&
					prior.deadline === wanted.deadline &&
					prior.clientId === wanted.clientId &&
					prior.audible === wanted.audible
				) {
					continue;
				}
				const result = yield* runDevice({
					target,
					pluginId,
					key: wanted.key,
					action: "schedule",
					audible: wanted.audible,
					deadline: wanted.deadline,
					title: timer === "rest" ? "Rest complete" : "Exercise complete",
					body:
						timer === "rest" ? "Your rest timer is complete." : "Your exercise timer is complete.",
				});
				if (result) {
					updateReady((currentState) => ({
						...currentState,
						alertStatus: { ...currentState.alertStatus, [timer]: result.status },
						deviceError:
							result.status === "denied" || result.status === "unsupported"
								? result.status
								: undefined,
					}));
				}
				if (
					result !== undefined &&
					(result.status === "scheduled" || result.status === "inexact")
				) {
					scheduledAlerts.set(timer, wanted);
				}
			}
		});
	};

	const synchronize = (draft: WorkoutEditorDraft | undefined, removedDraftId?: string) =>
		Effect.gen(function* () {
			yield* syncAlerts(draft, removedDraftId);
			yield* syncShortcut(draft);
			if (draft !== undefined) {
				yield* scheduleTimerCallbacks(draft);
			} else {
				for (const { cancel } of timerCallbacks.values()) {
					cancel();
				}
				timerCallbacks.clear();
			}
		});

	const persistDraft = (draft: WorkoutEditorDraft) =>
		Effect.try({
			try: () => encodeWorkoutEditorDraft(draft),
			catch: () => new RyotClientError("invalid-input"),
		}).pipe(
			Effect.flatMap(ports.storage.write),
			Effect.tapError((error) =>
				Effect.sync(() =>
					updateReady((latest) => ({ ...latest, dirty: true, persistenceError: error })),
				),
			),
		);

	const flushDraft = () =>
		persistenceSemaphore.withPermit(
			Effect.gen(function* () {
				for (;;) {
					if (!isReady(snapshot)) {
						return;
					}
					const current = snapshot;
					if (revision <= persistedRevision) {
						yield* synchronize(current.draft);
						return;
					}
					const writingRevision = revision;
					yield* persistDraft(current.draft);
					persistedRevision = Math.max(persistedRevision, writingRevision);
					updateReady((latest) => ({
						...latest,
						persistenceError: undefined,
						dirty: revision > persistedRevision,
					}));
					if (revision <= persistedRevision) {
						yield* synchronize(isReady(snapshot) ? snapshot.draft : undefined);
						return;
					}
				}
			}),
		);
	const flush = () =>
		mediaSemaphore.withPermit(
			Effect.gen(function* () {
				yield* flushDraft();
				yield* cleanupAbandonedMedia();
			}),
		);

	const cleanupAssets = (assets: readonly ManagedAssetLocator[]) =>
		Effect.forEach(assets, (asset) => ports.cleanup?.(asset).pipe(Effect.ignore) ?? Effect.void, {
			discard: true,
		});

	const cleanupAbandonedMedia = () =>
		Effect.gen(function* () {
			if (
				disposed ||
				!isReady(snapshot) ||
				snapshot.saving ||
				snapshot.draft.submission !== undefined ||
				ports.cleanup === undefined
			) {
				return;
			}
			const draftId = snapshot.draft.draftId;
			const media = draftMedia(snapshot.draft);
			const abandoned = (snapshot.draft.uploadedAssets ?? []).filter(
				(asset) => !media.some((candidate) => sameMedia(candidate, asset)),
			);
			if (abandoned.length === 0) {
				return;
			}
			for (const asset of abandoned) {
				const cleaned = yield* ports
					.cleanup(asset)
					.pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
				const latest = getSnapshot();
				if (
					cleaned &&
					isReady(latest) &&
					latest.draft.draftId === draftId &&
					latest.draft.submission === undefined
				) {
					setDraft({
						...latest.draft,
						uploadedAssets: latest.draft.uploadedAssets?.filter(
							(candidate) => !sameMedia(candidate, asset),
						),
					});
				}
			}
			yield* flushDraft();
		});

	const startFlush = () => {
		if (
			disposed ||
			flushRunning ||
			ports.schedule === undefined ||
			!isReady(snapshot) ||
			!snapshot.dirty
		) {
			return;
		}
		flushRunning = true;
		ports.schedule.run(flush().pipe(Effect.ignore), () => {
			flushRunning = false;
			if (isReady(snapshot) && snapshot.dirty && snapshot.persistenceError === undefined) {
				startFlush();
			}
		});
	};

	const setDraft = (draft: WorkoutEditorDraft, allowSubmission = false) => {
		if (!isReady(snapshot)) {
			return false;
		}
		const withSubmission = allowSubmission
			? draft
			: { ...draft, submission: snapshot.draft.submission };
		const validTimers = invalidateWorkoutCountdowns(withSubmission).draft;
		revision += 1;
		updateReady((current) => ({
			...current,
			dirty: true,
			draft: validTimers,
			timerError: undefined,
			persistenceError: undefined,
		}));
		startFlush();
		return true;
	};

	const refreshContext = () => {
		if (ports.refreshContext === undefined) {
			return Effect.void;
		}
		return Effect.match(ports.refreshContext, {
			onFailure: (error) => {
				setContextFailure(error);
				return undefined;
			},
			onSuccess: (context) => {
				publish({ ...snapshot, context, contextError: undefined });
				return undefined;
			},
		});
	};

	const load = () =>
		loadSemaphore.withPermit(
			Effect.gen(function* () {
				disposed = false;
				if (loaded && !loadFailed) {
					yield* reconcile();
					return;
				}
				publish({
					status: "loading",
					context: snapshot.context,
					contextError: snapshot.contextError,
				});
				const result = yield* Effect.match(ports.storage.read, {
					onFailure: (error) => ({ error, kind: "failure" as const }),
					onSuccess: (rawValue) => ({ rawValue, kind: "success" as const }),
				});
				loaded = true;
				loadFailed = result.kind === "failure";
				if (result.kind === "failure") {
					publish({
						error: result.error,
						rawValue: undefined,
						status: "recovery-error",
						context: snapshot.context,
						contextError: snapshot.contextError,
					});
					return;
				}
				if (result.rawValue === null) {
					revision = 0;
					persistedRevision = 0;
					publish({
						status: "empty",
						context: snapshot.context,
						contextError: snapshot.contextError,
					});
					yield* refreshContext();
					yield* synchronize(undefined);
					return;
				}
				const decoded = decodeWorkoutEditorDraft(result.rawValue);
				if (decoded._tag === "Failure") {
					loadFailed = true;
					publish({
						error: decoded.failure,
						status: "recovery-error",
						context: snapshot.context,
						rawValue: result.rawValue,
						contextError: snapshot.contextError,
					});
					return;
				}
				revision = 0;
				persistedRevision = 0;
				loadFailed = false;
				const invalidated = invalidateWorkoutCountdowns(decoded.success);
				const recovered = invalidated.draft;
				revision = invalidated.changed ? 1 : 0;
				persistedRevision = 0;
				publish({
					saving: false,
					alertStatus: {},
					status: "ready",
					uploading: false,
					draft: recovered,
					timerError: undefined,
					deviceError: undefined,
					context: snapshot.context,
					dirty: invalidated.changed,
					persistenceError: undefined,
					contextError: snapshot.contextError,
				});
				yield* reconcile();
			}),
		);

	const reconcile = (expected?: {
		readonly executionClientId?: string;
		readonly restClientId?: string;
	}) =>
		Effect.gen(function* () {
			if (isDisposed() || !ports.foreground()) {
				return;
			}
			if (expected === undefined) {
				yield* refreshContext();
			}
			if (isDisposed() || !ports.foreground() || !isReady(snapshot)) {
				return;
			}
			if (snapshot.draft.submission !== undefined) {
				yield* flush();
				return;
			}
			const now = yield* Effect.match(ports.now, {
				onSuccess: (value) => value,
				onFailure: (error) => {
					updateReady((current) => ({ ...current, timerError: error }));
					return undefined;
				},
			});
			if (now === undefined) {
				return;
			}
			let draft = snapshot.draft;
			const rest = draft.restCountdown;
			const execution = draft.executionCountdown;
			let completed = false;
			if (
				execution !== undefined &&
				execution.pausedRemainingSeconds === undefined &&
				Date.parse(execution.deadline) <= now &&
				(expected === undefined || execution.clientId === expected.executionClientId)
			) {
				const next = completeWorkoutSet(draft, {
					overrides: {},
					observedAt: now,
					setId: execution.setId,
					now: Date.parse(execution.deadline),
					occurrenceId: execution.occurrenceId,
					timerId: `${execution.clientId}:rest`,
					settings: snapshot.context?.settings ?? {},
					prompt:
						draft.localPreferences?.promptForRestTimer ??
						snapshot.context?.settings.promptForRestTimer ??
						false,
				});
				completed = next !== draft;
				draft = next;
			}
			const result = reconcileWorkoutTimers(draft, now, expected);
			if (result.changed || completed) {
				setDraft(result.draft);
			}
			yield* flush();
			if (
				(completed && execution !== undefined && now - Date.parse(execution.deadline) < 1500) ||
				(rest !== undefined &&
					rest.pausedRemainingSeconds === undefined &&
					Date.parse(rest.deadline) <= now &&
					now - Date.parse(rest.deadline) < 1500 &&
					result.draft.restCountdown?.clientId !== rest.clientId)
			) {
				yield* ports.feedback?.() ?? Effect.void;
			}
		});

	const removeDraft = (requiresSubmission: boolean) =>
		persistenceSemaphore.withPermit(
			Effect.gen(function* () {
				if (discarding || (isReady(snapshot) && (snapshot.saving || snapshot.uploading))) {
					return false;
				}
				if (requiresSubmission) {
					if (!isReady(snapshot) || snapshot.draft.submission === undefined) {
						return false;
					}
				} else if (!canDiscard()) {
					return false;
				}
				if (!requiresSubmission && isReady(snapshot) && snapshot.draft.submission !== undefined) {
					return false;
				}
				discarding = true;
				const removedDraftId = isReady(snapshot) ? snapshot.draft.draftId : undefined;
				const uploadedAssets = isReady(snapshot) ? (snapshot.draft.uploadedAssets ?? []) : [];
				const removed = yield* Effect.match(ports.storage.remove, {
					onSuccess: () => ({ kind: "success" as const }),
					onFailure: (error) => ({ error, kind: "failure" as const }),
				});
				discarding = false;
				if (removed.kind === "failure") {
					if (isReady(snapshot)) {
						updateReady((current) => ({ ...current, persistenceError: removed.error }));
					} else if (isRecoveryError(snapshot)) {
						publish({ ...snapshot, error: removed.error });
					}
					return yield* Effect.fail(removed.error);
				}
				revision = 0;
				persistedRevision = 0;
				loadFailed = false;
				loaded = true;
				const context = snapshot.context;
				const contextError = snapshot.contextError;
				publish({ context, contextError, status: "empty" });
				yield* synchronize(undefined, removedDraftId);
				yield* cleanupAssets(uploadedAssets);
				return true;
			}).pipe(Effect.uninterruptible),
		);

	return {
		load,
		flush,
		reconcile,
		getSnapshot,
		refreshContext,
		finish: () => removeDraft(true),
		discard: () => removeDraft(false),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: () => {
			disposed = true;
			for (const { cancel } of timerCallbacks.values()) {
				cancel();
			}
			timerCallbacks.clear();
		},
		setSaving: (saving) => {
			if (saving) {
				canReleaseRejection = firstSubmissionAttempt;
				firstSubmissionAttempt = false;
			}
			updateReady((current) => ({ ...current, saving }));
		},
		change: (transform) => {
			if (
				disposed ||
				!isReady(snapshot) ||
				snapshot.saving ||
				discarding ||
				snapshot.draft.submission !== undefined
			) {
				return false;
			}
			const next = transform(snapshot.draft);
			if (next === snapshot.draft) {
				return false;
			}
			return setDraft(next);
		},
		rejectSubmission: (result) =>
			Effect.gen(function* () {
				const firstAttempt = canReleaseRejection;
				canReleaseRejection = false;
				if (
					!isReady(snapshot) ||
					snapshot.saving ||
					!firstAttempt ||
					!("canEdit" in result) ||
					result.canEdit !== true
				) {
					return false;
				}
				setDraft({ ...snapshot.draft, submission: undefined }, true);
				yield* flush();
				return true;
			}),
		start: (draft) =>
			Effect.gen(function* () {
				if (!isEmpty() || discarding) {
					return false;
				}
				loaded = true;
				loadFailed = false;
				revision += 1;
				publish({
					draft,
					dirty: true,
					saving: false,
					alertStatus: {},
					status: "ready",
					uploading: false,
					timerError: undefined,
					deviceError: undefined,
					context: snapshot.context,
					persistenceError: undefined,
					contextError: snapshot.contextError,
				});
				yield* flush();
				return true;
			}),
		beginSubmission: (input) =>
			Effect.gen(function* () {
				if (!isReady(snapshot) || snapshot.saving || snapshot.uploading || discarding) {
					return yield* new RyotClientError("invalid-input");
				}
				if (snapshot.draft.submission === undefined) {
					firstSubmissionAttempt = true;
				}
				const submission = snapshot.draft.submission ?? input;
				setDraft(
					{
						...snapshot.draft,
						submission,
						pendingRest: undefined,
						restCountdown: undefined,
						executionCountdown: undefined,
					},
					true,
				);
				yield* flush();
				return submission;
			}),
		uploadMedia: (target, kind, file) =>
			mediaSemaphore.withPermit(
				Effect.gen(function* () {
					const upload = ports.upload;
					if (
						disposed ||
						discarding ||
						!isReady(snapshot) ||
						snapshot.saving ||
						snapshot.draft.submission !== undefined ||
						upload === undefined ||
						targetMedia(snapshot.draft, target) === undefined
					) {
						return yield* new RyotClientError("invalid-input");
					}
					if (target.kind === "workout" && snapshot.context?.proAvailable !== true) {
						return yield* new RyotClientError("invalid-input");
					}
					const draftId = snapshot.draft.draftId;
					updateReady((current) => ({ ...current, uploading: true, uploadError: undefined }));
					yield* Effect.gen(function* () {
						const asset = yield* upload({
							source: file,
							fileName: file.name,
							contentType: file.type,
						});
						if (
							disposed ||
							!isReady(snapshot) ||
							snapshot.draft.draftId !== draftId ||
							snapshot.draft.submission !== undefined ||
							targetMedia(snapshot.draft, target) === undefined
						) {
							yield* cleanupAssets([asset]);
							return;
						}
						setDraft(attachDraftMedia(snapshot.draft, target, kind, asset));
						yield* flushDraft();
					}).pipe(
						Effect.tapError((error) =>
							Effect.sync(() => updateReady((current) => ({ ...current, uploadError: error }))),
						),
						Effect.ensuring(
							Effect.sync(() => updateReady((current) => ({ ...current, uploading: false }))),
						),
					);
					return undefined;
				}),
			),
	};
};
