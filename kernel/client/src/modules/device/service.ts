import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type {
	PluginDeviceOutcome,
	PluginDeviceRequest,
	PluginDeviceResult,
	PluginHapticKind,
	PluginNavigationTarget,
} from "@ryot-app/plugin-client-contract";
import { Context, Data, Effect, Exit, Layer, Scope, Semaphore } from "effect";

import type { ApiScope } from "#/api/scope";
import { apiScopeKey } from "#/api/scope";
import {
	type DeviceState,
	emptyDeviceState,
	MAX_ALERTS,
	MAX_NATIVE_ALERT_ID,
} from "#/modules/device/state";
import { validatePluginLocation } from "#/modules/plugins/catalog/location";
import { ClientStorage } from "#/persistence/storage";

const MAX_PATH_LENGTH = 512;
const MAX_SEARCH_LENGTH = 1024;

type ScheduleRequest = Extract<PluginDeviceRequest, { action: "schedule" }>;

export class DevicePlatformError extends Data.TaggedError("DevicePlatformError")<{
	readonly cause: unknown;
}> {}

const platformError = (cause: unknown) => new DevicePlatformError({ cause });

export class DevicePlatform extends Context.Service<
	DevicePlatform,
	{
		readonly haptic: (kind: PluginHapticKind) => Effect.Effect<void>;
		readonly cancel: (id: number) => Effect.Effect<void, DevicePlatformError>;
		readonly awake: (enabled: boolean) => Effect.Effect<void, DevicePlatformError>;
		readonly schedule: (
			id: number,
			request: ScheduleRequest,
		) => Effect.Effect<PluginDeviceResult, DevicePlatformError>;
		readonly listen: (
			tap: (id: number) => void,
			foreground: (active: boolean) => void,
			delivered: (id: number) => void,
		) => Effect.Effect<void, DevicePlatformError, Scope.Scope>;
	}
>()("DevicePlatform") {}

export class DeviceService extends Context.Service<DeviceService>()("DeviceService", {
	make: Effect.gen(function* () {
		const platform = yield* DevicePlatform;
		const storage = yield* ClientStorage;
		const serviceScope = yield* Effect.scope;
		const runFork = Effect.runForkWith(yield* Effect.context());
		const mutex = Semaphore.makeUnsafe(1);
		const listeners = new Set<() => void>();
		const alertListeners = new Set<() => void>();
		const demands = new Map<string, { active: boolean; enabled: boolean }>();
		let state: DeviceState = emptyDeviceState;
		let loaded = false;
		let activeScope: string | undefined;
		let foreground = true;
		let awake = false;
		let pendingTap: number | undefined;
		let listenerScope: undefined | Scope.Closeable;
		let navigate: undefined | ((target: PluginNavigationTarget) => void);
		const publish = () => listeners.forEach((listener) => listener());
		const load = Effect.gen(function* () {
			if (!loaded) {
				state = yield* storage.getDeviceState.pipe(Effect.mapError(platformError));
				loaded = true;
			}
		});
		const commit = Effect.fn("DeviceService.commit")(function* (next: DeviceState) {
			yield* storage.setDeviceState(next).pipe(Effect.mapError(platformError));
			state = next;
			publish();
		});
		const updateAwake = Effect.fn("DeviceService.updateAwake")(function* () {
			const enabled =
				foreground &&
				activeScope !== undefined &&
				[...demands.values()].some((demand) => demand.enabled && demand.active);
			if (awake !== enabled) {
				yield* platform.awake(enabled);
				awake = enabled;
			}
		});
		const routeTap = () => {
			const alert = state.alerts.find(({ id }) => id === pendingTap);
			if (!alert) {
				pendingTap = undefined;
				return;
			}
			if (alert.scope === activeScope && navigate) {
				pendingTap = undefined;
				navigate(alert.target);
			}
		};
		const start = mutex.withPermit(
			Effect.gen(function* () {
				yield* load;
				if (listenerScope) {
					return;
				}
				yield* Effect.uninterruptibleMask((restore) =>
					Effect.gen(function* () {
						const registration = yield* Scope.fork(serviceScope);
						yield* restore(
							platform.listen(
								(id) => {
									pendingTap = id;
									routeTap();
								},
								(active) => {
									foreground = active;
									runFork(mutex.withPermit(updateAwake()));
								},
								(id) => {
									if (
										state.alerts.some((alert) => alert.id === id && alert.scope === activeScope)
									) {
										alertListeners.forEach((listener) => listener());
									}
								},
							),
						).pipe(
							Scope.provide(registration),
							Effect.onExit((exit) =>
								Exit.isFailure(exit) ? Scope.close(registration, exit) : Effect.void,
							),
						);
						listenerScope = registration;
					}),
				);
			}),
		);
		const setScope = Effect.fn("DeviceService.setScope")(function* (
			scope: ApiScope | undefined,
			onNavigate?: (target: PluginNavigationTarget) => void,
		) {
			const next = scope === undefined ? undefined : apiScopeKey(scope);
			if (activeScope !== next) {
				demands.clear();
			}
			activeScope = next;
			navigate = onNavigate;
			yield* mutex.withPermit(
				Effect.gen(function* () {
					yield* load;
					const boundScope = activeScope;
					yield* updateAwake();
					for (const alert of state.alerts) {
						if (alert.scope !== boundScope) {
							yield* platform.cancel(alert.id);
						}
					}
					yield* commit({
						...state,
						alerts: state.alerts.filter((alert) => alert.scope === boundScope),
					});
					routeTap();
				}),
			);
		});
		const releaseFrame = (frame: string) =>
			mutex.withPermit(
				Effect.gen(function* () {
					demands.delete(frame);
					yield* updateAwake();
				}),
			);
		const setFrameActive = (frame: string, active: boolean) =>
			mutex.withPermit(
				Effect.gen(function* () {
					const demand = demands.get(frame);
					if (demand) {
						demands.set(frame, { ...demand, active });
					}
					yield* updateAwake();
				}),
			);
		const outcome = (
			scope: ApiScope,
			contributors: PreparedClientPage["identity"]["contributors"],
			frame: string,
			active: boolean,
			request: PluginDeviceRequest,
		): Effect.Effect<PluginDeviceOutcome> =>
			mutex
				.withPermit(
					Effect.gen(function* () {
						yield* load;
						const key = apiScopeKey(scope);
						if (activeScope !== key) {
							return { outcome: "failure", reason: "invalid-request" } as const;
						}
						if (request.action === "haptic") {
							if (active && foreground) {
								yield* platform.haptic(request.kind);
							}
							return { outcome: "success", value: { status: "done" } } as const;
						}
						const owner = contributors.find(
							(contributor) =>
								contributor.kind === "plugin" && contributor.pluginId === request.pluginId,
						);
						if (owner?.kind !== "plugin") {
							return { outcome: "failure", reason: "invalid-request" } as const;
						}
						let target: undefined | PluginNavigationTarget;
						if (request.action === "schedule") {
							target = request.target;
						} else if (request.action === "return-shortcut") {
							target = request.shortcut?.target;
						}
						if (
							target?.kind === "plugin-route" &&
							(target.path.length > MAX_PATH_LENGTH ||
								target.search.length > MAX_SEARCH_LENGTH ||
								!validatePluginLocation({ ...target, kind: "route" }))
						) {
							return { outcome: "failure", reason: "invalid-request" } as const;
						}
						const owned = (entry: { scope: string; installationId: string }) =>
							entry.scope === key && entry.installationId === owner.installationId;
						let value: PluginDeviceResult = { status: "done" };
						if (request.action === "awake") {
							demands.set(frame, { active, enabled: request.enabled });
							yield* updateAwake();
						} else if (request.action === "return-shortcut") {
							yield* commit({
								...state,
								shortcuts: [
									...state.shortcuts.filter((entry) => !owned(entry)),
									...(request.shortcut === null
										? []
										: [
												{
													...request.shortcut,
													scope: key,
													pluginId: request.pluginId,
													installationId: owner.installationId,
												},
											]),
								],
							});
						} else {
							const previous = state.alerts.filter(
								(entry) => owned(entry) && entry.key === request.key,
							);
							for (const entry of previous) {
								yield* platform.cancel(entry.id);
							}
							const alerts = state.alerts.filter((entry) => !previous.includes(entry));
							if (request.action === "cancel") {
								yield* commit({ ...state, alerts });
							} else {
								const id = state.nextId;
								if (id > MAX_NATIVE_ALERT_ID || alerts.length >= MAX_ALERTS) {
									return { outcome: "failure", reason: "invalid-request" } as const;
								}
								yield* commit({
									...state,
									nextId: id + 1,
									alerts: [
										...alerts,
										{
											id,
											scope: key,
											key: request.key,
											target: request.target,
											pluginId: request.pluginId,
											installationId: owner.installationId,
										},
									],
								});
								value = yield* platform.schedule(id, request);
							}
						}
						return { value, outcome: "success" } as const;
					}).pipe(Effect.uninterruptible),
				)
				.pipe(Effect.orElseSucceed(() => ({ outcome: "failure", reason: "transport" }) as const));
		return {
			start,
			outcome,
			setScope,
			releaseFrame,
			setFrameActive,
			shortcuts: () => state.shortcuts,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			subscribeAlerts: (listener: () => void) => {
				alertListeners.add(listener);
				return () => {
					alertListeners.delete(listener);
				};
			},
			stop: mutex.withPermit(
				Effect.gen(function* () {
					if (listenerScope) {
						yield* Scope.close(listenerScope, Exit.void);
						listenerScope = undefined;
					}
					demands.clear();
					foreground = false;
					yield* updateAwake();
				}).pipe(Effect.uninterruptible),
			),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
