import { type ManagedAssetLocator, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect, Semaphore } from "@ryot-app/plugin-client-sdk/effect";

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
import { createAlertSynchronizer } from "./controller-alerts";
import type {
	ReadySnapshot,
	WorkoutEditorControllerPorts,
	WorkoutEditorControllerSnapshot,
} from "./controller-types";
import { createWorkoutIosActivityPublisher } from "./ios-live-activity-sync";
import {
	attachDraftMedia,
	draftMedia,
	sameMedia,
	targetMedia,
	type WorkoutMediaKind,
	type WorkoutMediaTarget,
} from "./media-state";
import { invalidateWorkoutCountdowns, reconcileWorkoutTimers } from "./timers";

type ExpectedCountdowns = { readonly executionClientId?: string; readonly restClientId?: string };

type WorkoutEditorController = {
	readonly setExerciseNames: (
		exercises: readonly { readonly id: string; readonly name: string }[],
	) => void;
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
	readonly reconcile: (expected?: ExpectedCountdowns) => Effect.Effect<void, unknown>;
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

const isReady = (snapshot: WorkoutEditorControllerSnapshot): snapshot is ReadySnapshot =>
	snapshot.status === "ready";

const isRecoveryError = (
	snapshot: WorkoutEditorControllerSnapshot,
): snapshot is Extract<WorkoutEditorControllerSnapshot, { readonly status: "recovery-error" }> =>
	snapshot.status === "recovery-error";

export const createWorkoutEditorController = (
	ports: WorkoutEditorControllerPorts,
): WorkoutEditorController => {
	const listeners = new Set<() => void>();
	const loadSemaphore = Semaphore.makeUnsafe(1);
	const persistenceSemaphore = Semaphore.makeUnsafe(1);
	const mediaSemaphore = Semaphore.makeUnsafe(1);
	let snapshot: WorkoutEditorControllerSnapshot = initialSnapshot;
	let loaded = false;
	let loadFailed = false;
	let revision = 0;
	let persistedRevision = 0;
	let flushRunning = false;
	let discarding = false;
	let disposed = false;
	const isDisposed = () => disposed;
	let exerciseNames: ReadonlyMap<string, string> = new Map();
	const iosActivity = createWorkoutIosActivityPublisher(ports);

	const publish = (next: WorkoutEditorControllerSnapshot) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};

	const getSnapshot = () => snapshot;
	const canDiscard = () => isReady(snapshot) || isRecoveryError(snapshot);

	const updateReady = (update: (current: ReadySnapshot) => ReadySnapshot) => {
		if (isReady(snapshot)) {
			publish(update(snapshot));
		}
	};

	const contextState = () => ({ context: snapshot.context, contextError: snapshot.contextError });

	const readySnapshot = (draft: WorkoutEditorDraft, dirty: boolean): ReadySnapshot => ({
		dirty,
		draft,
		saving: false,
		alertStatus: {},
		status: "ready",
		uploading: false,
		timerError: undefined,
		deviceError: undefined,
		persistenceError: undefined,
		...contextState(),
	});

	const alerts = createAlertSynchronizer({
		ports,
		isDisposed,
		getSnapshot,
		updateReady,
		foreground: ports.foreground,
		reconcile: (expected) => reconcile(expected),
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
						yield* alerts.synchronize(current.draft);
						iosActivity.synchronize(
							current.draft,
							exerciseNames,
							snapshot.context?.settings.unitSystem === "imperial",
						);
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
						yield* alerts.synchronize(isReady(snapshot) ? snapshot.draft : undefined);
						iosActivity.synchronize(
							isReady(snapshot) ? snapshot.draft : undefined,
							exerciseNames,
							snapshot.context?.settings.unitSystem === "imperial",
						);
						return;
					}
				}
			}),
		);

	const cleanupAssets = (assets: readonly ManagedAssetLocator[]) =>
		Effect.forEach(assets, (asset) => ports.cleanup(asset).pipe(Effect.ignore), { discard: true });

	const cleanupAbandonedMedia = () =>
		Effect.gen(function* () {
			if (
				disposed ||
				!isReady(snapshot) ||
				snapshot.saving ||
				snapshot.draft.submission !== undefined
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

	const flush = () =>
		mediaSemaphore.withPermit(
			Effect.gen(function* () {
				yield* flushDraft();
				yield* cleanupAbandonedMedia();
			}),
		);

	const startFlush = () => {
		if (disposed || flushRunning || !isReady(snapshot) || !snapshot.dirty) {
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

	const refreshContext = () =>
		Effect.match(ports.refreshContext, {
			onFailure: (error) => {
				publish({ ...snapshot, contextError: error });
			},
			onSuccess: (context) => {
				publish({ ...snapshot, context, contextError: undefined });
			},
		});

	const load = () =>
		loadSemaphore.withPermit(
			Effect.gen(function* () {
				disposed = false;
				if (loaded && !loadFailed) {
					yield* reconcile();
					return;
				}
				publish({ status: "loading", ...contextState() });
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
						...contextState(),
					});
					return;
				}
				if (result.rawValue === null) {
					revision = 0;
					persistedRevision = 0;
					publish({ status: "empty", ...contextState() });
					yield* refreshContext();
					yield* alerts.synchronize(undefined);
					iosActivity.synchronize(undefined, exerciseNames);
					return;
				}
				const decoded = decodeWorkoutEditorDraft(result.rawValue);
				if (decoded._tag === "Failure") {
					loadFailed = true;
					publish({
						error: decoded.failure,
						status: "recovery-error",
						rawValue: result.rawValue,
						...contextState(),
					});
					return;
				}
				const invalidated = invalidateWorkoutCountdowns(decoded.success);
				loadFailed = false;
				revision = invalidated.changed ? 1 : 0;
				persistedRevision = 0;
				publish(readySnapshot(invalidated.draft, invalidated.changed));
				yield* reconcile();
			}),
		);

	const reconcile = (expected?: ExpectedCountdowns) =>
		Effect.gen(function* () {
			if (disposed || !ports.foreground()) {
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
			const now = yield* alerts.readNow;
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
				yield* ports.feedback();
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
				const removedDraft = isReady(snapshot) ? snapshot.draft : undefined;
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
				publish({ status: "empty", ...contextState() });
				yield* alerts.synchronize(undefined, removedDraftId);
				iosActivity.finish(
					removedDraft,
					exerciseNames,
					requiresSubmission,
					snapshot.context?.settings.unitSystem === "imperial",
				);
				if (removedDraft === undefined) {
					iosActivity.synchronize(undefined, exerciseNames);
				}
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
		dispose: () => {
			disposed = true;
			alerts.dispose();
		},
		setSaving: (saving) => {
			updateReady((current) => ({ ...current, saving }));
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		rejectSubmission: (result) =>
			Effect.gen(function* () {
				if (!isReady(snapshot) || snapshot.saving || result.kind === "saved") {
					return false;
				}
				setDraft({ ...snapshot.draft, submission: undefined }, true);
				yield* flush();
				return true;
			}),
		start: (draft) =>
			Effect.gen(function* () {
				if (snapshot.status !== "empty" || discarding) {
					return false;
				}
				loaded = true;
				loadFailed = false;
				revision += 1;
				publish(readySnapshot(draft, true));
				yield* flush();
				return true;
			}),
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
		setExerciseNames: (exercises) => {
			const next = new Map(exercises.map(({ id, name }) => [id, name]));
			if (
				next.size === exerciseNames.size &&
				[...next].every(([id, name]) => exerciseNames.get(id) === name)
			) {
				return;
			}
			exerciseNames = next;
			ports.schedule.run(flushDraft().pipe(Effect.ignore), () => undefined);
		},
		beginSubmission: (input) =>
			Effect.gen(function* () {
				if (!isReady(snapshot) || snapshot.saving || snapshot.uploading || discarding) {
					return yield* new RyotClientError("invalid-input");
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
					if (
						disposed ||
						discarding ||
						!isReady(snapshot) ||
						snapshot.saving ||
						snapshot.draft.submission !== undefined ||
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
						const asset = yield* ports.upload({
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
