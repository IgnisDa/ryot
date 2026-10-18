import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { PluginDeviceRequest, PluginDeviceResult } from "@ryot-app/plugin-client-sdk/plugin";

import type { WorkoutEditorDraft } from "../../shared/workout-editor-draft";
import type {
	ReadySnapshot,
	TimerName,
	WorkoutEditorControllerPorts,
	WorkoutEditorControllerSnapshot,
} from "./controller-types";

type TimerSnapshot = {
	readonly clientId: string;
	readonly deadline: string;
	readonly key: string;
	readonly audible: boolean;
};

type ExpectedCountdowns = { readonly executionClientId?: string; readonly restClientId?: string };

const timerNames = ["execution", "rest"] as const;
const warningOffsets = [3000, 2000, 1000];

const alertKey = (draftId: string, timer: TimerName) =>
	`fitness-workout-editor:${draftId}:${timer}`;

export const createAlertSynchronizer = (host: {
	readonly ports: Pick<
		WorkoutEditorControllerPorts,
		"device" | "now" | "pluginId" | "schedule" | "target"
	>;
	readonly isDisposed: () => boolean;
	readonly foreground: () => boolean;
	readonly getSnapshot: () => WorkoutEditorControllerSnapshot;
	readonly updateReady: (update: (current: ReadySnapshot) => ReadySnapshot) => void;
	readonly reconcile: (expected: ExpectedCountdowns) => Effect.Effect<void, unknown>;
}) => {
	const { ports } = host;
	const timerCallbacks = new Map<
		TimerName,
		{ readonly cancel: () => void; readonly snapshot: TimerSnapshot }
	>();
	const scheduledAlerts = new Map<TimerName, TimerSnapshot>();
	let shortcutSet: boolean | undefined;

	const readNow = Effect.match(ports.now, {
		onSuccess: (now): number | undefined => now,
		onFailure: (error) => {
			host.updateReady((current) => ({ ...current, timerError: error }));
			return undefined;
		},
	});

	const runDevice = (request: PluginDeviceRequest): Effect.Effect<PluginDeviceResult | undefined> =>
		Effect.match(ports.device(request), {
			onSuccess: (result) => result,
			onFailure: (error) => {
				host.updateReady((current) => ({ ...current, deviceError: error }));
				return undefined;
			},
		});

	const syncShortcut = (draft: WorkoutEditorDraft | undefined) => {
		const shouldSet = draft?.mode.kind === "live" && draft.endedAt === undefined;
		if (shouldSet === shortcutSet) {
			return Effect.void;
		}
		return Effect.tap(
			runDevice({
				pluginId: ports.pluginId,
				action: "return-shortcut",
				shortcut: shouldSet ? { target: ports.target, label: "Resume workout" } : null,
			}),
			(result) =>
				Effect.sync(() => {
					if (
						result !== undefined &&
						result.status !== "denied" &&
						result.status !== "unsupported"
					) {
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
				host.getSnapshot().context?.settings.muteSounds ??
				false
			),
		};
	};

	const matchesDesiredTimer = (timer: TimerName, wanted: TimerSnapshot) => {
		const snapshot = host.getSnapshot();
		if (snapshot.status !== "ready") {
			return false;
		}
		const current = desiredTimer(snapshot.draft, timer);
		return current?.clientId === wanted.clientId && current.deadline === wanted.deadline;
	};

	const pulseTimerWarning = Effect.fnUntraced(function* (
		timer: TimerName,
		wanted: TimerSnapshot,
		pulseAt: number,
	) {
		const canPulse = () =>
			!host.isDisposed() && host.foreground() && matchesDesiredTimer(timer, wanted);
		if (!canPulse()) {
			return;
		}
		const now = yield* readNow;
		if (now === undefined || !Number.isFinite(now) || now - pulseAt > 500 || !canPulse()) {
			return;
		}
		yield* runDevice({ kind: "impact", action: "haptic", pluginId: ports.pluginId });
	});

	const cancelTimerCallbacks = () => {
		for (const { cancel } of timerCallbacks.values()) {
			cancel();
		}
		timerCallbacks.clear();
	};

	const scheduleTimerCallbacks = (draft: WorkoutEditorDraft) =>
		host.isDisposed()
			? Effect.void
			: Effect.map(readNow, (now) => {
					if (now === undefined) {
						return;
					}
					for (const timer of timerNames) {
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
						if (wanted === undefined) {
							continue;
						}
						const expected =
							timer === "execution"
								? { executionClientId: wanted.clientId }
								: { restClientId: wanted.clientId };
						const { schedule } = ports;
						const cancels: (() => void)[] = [];
						for (const offset of warningOffsets) {
							const pulseAt = Date.parse(wanted.deadline) - offset;
							if (pulseAt > now) {
								cancels.push(
									schedule.after(pulseAt - now, () =>
										schedule.run(
											Effect.ignore(pulseTimerWarning(timer, wanted, pulseAt)),
											() => undefined,
										),
									),
								);
							}
						}
						cancels.push(
							schedule.after(Math.max(0, Date.parse(wanted.deadline) - now), () =>
								schedule.run(Effect.ignore(host.reconcile(expected)), () => undefined),
							),
						);
						const cancel = () => {
							for (const cancelCallback of cancels) {
								cancelCallback();
							}
						};
						timerCallbacks.set(timer, { cancel, snapshot: wanted });
					}
				});

	const cancelAlert = (timer: TimerName, key: string) =>
		Effect.gen(function* () {
			const cancelled = yield* runDevice({ key, action: "cancel", pluginId: ports.pluginId });
			if (cancelled !== undefined && cancelled.status !== "denied") {
				scheduledAlerts.delete(timer);
			}
		});

	const syncAlerts = (draft: WorkoutEditorDraft | undefined, removedDraftId?: string) =>
		Effect.gen(function* () {
			for (const timer of timerNames) {
				const wanted = draft === undefined ? undefined : desiredTimer(draft, timer);
				const current = scheduledAlerts.get(timer);
				if (wanted === undefined) {
					const draftId = draft?.draftId ?? removedDraftId;
					const stableKey = draftId === undefined ? undefined : alertKey(draftId, timer);
					for (const key of new Set([current?.key, stableKey])) {
						if (key !== undefined) {
							yield* cancelAlert(timer, key);
						}
					}
					continue;
				}
				if (current !== undefined && current.key !== wanted.key) {
					yield* cancelAlert(timer, current.key);
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
					key: wanted.key,
					action: "schedule",
					target: ports.target,
					audible: wanted.audible,
					pluginId: ports.pluginId,
					deadline: wanted.deadline,
					title: timer === "rest" ? "Rest complete" : "Exercise complete",
					body:
						timer === "rest" ? "Your rest timer is complete." : "Your exercise timer is complete.",
				});
				if (result === undefined) {
					continue;
				}
				host.updateReady((currentState) => ({
					...currentState,
					alertStatus: { ...currentState.alertStatus, [timer]: result.status },
					deviceError:
						result.status === "denied" || result.status === "unsupported"
							? result.status
							: undefined,
				}));
				if (result.status === "scheduled" || result.status === "inexact") {
					scheduledAlerts.set(timer, wanted);
				}
			}
		});

	return {
		readNow,
		dispose: cancelTimerCallbacks,
		synchronize: (draft: WorkoutEditorDraft | undefined, removedDraftId?: string) =>
			Effect.gen(function* () {
				yield* syncAlerts(draft, removedDraftId);
				yield* syncShortcut(draft);
				if (draft === undefined) {
					cancelTimerCallbacks();
				} else {
					yield* scheduleTimerCallbacks(draft);
				}
			}),
	};
};
