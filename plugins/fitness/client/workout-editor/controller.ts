import { RyotClientError } from "@ryot-app/plugin-client-sdk";
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
import { type ExpectedCountdowns, reconcileWorkoutTimers } from "./actions";
import { createAlertSynchronizer } from "./controller-alerts";
import {
	isWorkoutEditorSaving,
	type ReadySnapshot,
	type WorkoutEditorContext,
	type WorkoutEditorControllerPorts,
	type WorkoutEditorControllerSnapshot,
} from "./controller-types";
import { createWorkoutIosActivityPublisher } from "./ios-live-activity-sync";
import {
	attachDraftMedia,
	targetMedia,
	type WorkoutMediaKind,
	type WorkoutMediaTarget,
} from "./media-state";
import { invalidateWorkoutCountdowns } from "./timers";

type WorkoutEditorController = {
	readonly dispose: () => void;
	readonly load: () => Effect.Effect<void, unknown>;
	readonly flush: () => Effect.Effect<void, unknown>;
	readonly discard: () => Effect.Effect<boolean, unknown>;
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => WorkoutEditorControllerSnapshot;
	readonly refreshContext: () => Effect.Effect<void, unknown>;
	readonly start: (draft: WorkoutEditorDraft) => Effect.Effect<boolean, unknown>;
	readonly reconcile: (expected?: ExpectedCountdowns) => Effect.Effect<void, unknown>;
	readonly change: (transform: (draft: WorkoutEditorDraft) => WorkoutEditorDraft) => boolean;
	readonly setExerciseNames: (
		exercises: readonly { readonly id: string; readonly name: string }[],
	) => void;
	readonly uploadMedia: (
		target: WorkoutMediaTarget,
		kind: WorkoutMediaKind,
		file: File,
	) => Effect.Effect<void, unknown>;
	readonly save: (
		prepare: (
			current: ReadySnapshot & { readonly context: WorkoutEditorContext },
		) => Effect.Effect<
			undefined | { readonly draft: WorkoutEditorDraft; readonly input: WorkoutEditorSaveInput },
			unknown
		>,
	) => Effect.Effect<undefined | WorkoutEditorSaveOutput, unknown>;
};

const initialSnapshot: WorkoutEditorControllerSnapshot = {
	status: "loading",
	context: undefined,
	contextError: undefined,
	saveState: { phase: "idle" },
};

const settledSaveState = (
	current: WorkoutEditorControllerSnapshot,
): WorkoutEditorControllerSnapshot["saveState"] => {
	const { saveState } = current;
	if (saveState.phase !== "acknowledged") {
		return { phase: "idle" };
	}
	return current.status === "empty"
		? { phase: "saved", result: saveState.result }
		: { ...saveState, cleaning: false };
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

	const contextState = () => ({
		context: snapshot.context,
		saveState: snapshot.saveState,
		contextError: snapshot.contextError,
	});

	const readySnapshot = (draft: WorkoutEditorDraft, dirty: boolean): ReadySnapshot => ({
		dirty,
		draft,
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

	const flush = () => mediaSemaphore.withPermit(flushDraft());

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
			const result = reconcileWorkoutTimers(snapshot.draft, now, {
				expected,
				settings: snapshot.context?.settings ?? {},
				prompt:
					snapshot.draft.localPreferences?.promptForRestTimer ??
					snapshot.context?.settings.promptForRestTimer ??
					false,
			});
			if (result.changed) {
				setDraft(result.draft);
			}
			yield* flush();
			if (result.feedback) {
				yield* ports.feedback();
			}
		});

	const removeDraft = (requiresSubmission: boolean) =>
		Effect.suspend(() => {
			if (!requiresSubmission && isWorkoutEditorSaving(snapshot)) {
				return Effect.succeed(false);
			}
			return persistenceSemaphore.withPermit(
				Effect.gen(function* () {
					if (
						discarding ||
						(!requiresSubmission && isWorkoutEditorSaving(snapshot)) ||
						(isReady(snapshot) && snapshot.uploading)
					) {
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
					return true;
				}).pipe(Effect.uninterruptible),
			);
		});

	return {
		load,
		flush,
		reconcile,
		getSnapshot,
		refreshContext,
		discard: () => removeDraft(false),
		dispose: () => {
			disposed = true;
			alerts.dispose();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		change: (transform) => {
			if (
				disposed ||
				!isReady(snapshot) ||
				isWorkoutEditorSaving(snapshot) ||
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
		start: (draft) =>
			Effect.gen(function* () {
				if (snapshot.status !== "empty" || discarding || isWorkoutEditorSaving(snapshot)) {
					return false;
				}
				loaded = true;
				loadFailed = false;
				revision += 1;
				publish({ ...readySnapshot(draft, true), saveState: { phase: "idle" } });
				yield* flush();
				return true;
			}),
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
		uploadMedia: (target, kind, file) =>
			mediaSemaphore.withPermit(
				Effect.gen(function* () {
					if (
						disposed ||
						discarding ||
						!isReady(snapshot) ||
						isWorkoutEditorSaving(snapshot) ||
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
		save: (prepare) =>
			Effect.gen(function* () {
				if (
					disposed ||
					isWorkoutEditorSaving(snapshot) ||
					discarding ||
					!isReady(snapshot) ||
					snapshot.uploading
				) {
					return undefined;
				}
				const acknowledged = snapshot.saveState;
				publish({
					...snapshot,
					saveState:
						acknowledged.phase === "acknowledged"
							? { ...acknowledged, cleaning: true }
							: { phase: "in-flight" },
				});
				return yield* Effect.gen(function* () {
					if (acknowledged.phase === "acknowledged") {
						yield* removeDraft(true);
						return acknowledged.result;
					}
					yield* reconcile();
					if (!isReady(snapshot)) {
						return undefined;
					}
					let submission = snapshot.draft.submission;
					if (submission === undefined) {
						const context = snapshot.context;
						if (context === undefined) {
							return undefined;
						}
						const prepared = yield* prepare({ ...snapshot, context });
						if (prepared === undefined) {
							return undefined;
						}
						submission = prepared.input;
						setDraft(
							{
								...prepared.draft,
								submission,
								pendingRest: undefined,
								restCountdown: undefined,
								executionCountdown: undefined,
							},
							true,
						);
					}
					yield* flush();
					const result = yield* ports.save(submission);
					if (result.kind === "saved") {
						publish({ ...snapshot, saveState: { result, cleaning: true, phase: "acknowledged" } });
						yield* removeDraft(true);
					} else if (isReady(snapshot)) {
						setDraft({ ...snapshot.draft, submission: undefined }, true);
						yield* flush();
					}
					return result;
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => publish({ ...snapshot, saveState: settledSaveState(snapshot) })),
					),
				);
			}).pipe(Effect.uninterruptible),
	};
};
