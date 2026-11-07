import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Context, Effect, Fiber, Layer, Schema } from "effect";

type ListenNativeResume = (
	notify: () => void,
) => Effect.Effect<undefined | PluginListenerHandle, NativeResumeListenerError>;

export class NativeResumeListenerError extends Schema.TaggedError<
	NativeResumeListenerError,
	{ readonly brand: unique symbol }
>()("NativeResumeListenerError", { cause: Schema.Unknown }) {}

const listenNativeResume: ListenNativeResume = (notify) =>
	Capacitor.isNativePlatform()
		? Effect.tryPromise({
				try: () => App.addListener("resume", notify),
				catch: (cause) => new NativeResumeListenerError({ cause }),
			})
		: Effect.undefined;

export const subscribeNativeResume = (
	resumed: () => void,
	listenResume: ListenNativeResume = listenNativeResume,
) => {
	let disposed = false;
	const notify = () => {
		if (!disposed) {
			resumed();
		}
	};
	const native = Effect.runFork(listenResume(notify).pipe(Effect.orElseSucceed(() => undefined)));
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		Effect.runFork(
			Fiber.join(native).pipe(
				Effect.flatMap((listener) =>
					listener === undefined ? Effect.void : Effect.promise(() => listener.remove()),
				),
				Effect.ignoreCause,
			),
		);
	};
};

export const subscribeEntityWatchLifecycle = (
	changed: () => void,
	platform: {
		readonly window: EventTarget;
		readonly document: EventTarget;
		readonly listenResume: ListenNativeResume;
	},
) => {
	let disposed = false;
	const notify = () => {
		if (!disposed) {
			changed();
		}
	};
	platform.document.addEventListener("visibilitychange", notify);
	platform.window.addEventListener("offline", notify);
	platform.window.addEventListener("online", notify);
	const releaseResume = subscribeNativeResume(notify, platform.listenResume);
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		platform.document.removeEventListener("visibilitychange", notify);
		platform.window.removeEventListener("offline", notify);
		platform.window.removeEventListener("online", notify);
		releaseResume();
	};
};

export class EntityWatchTransport extends Context.Service<
	EntityWatchTransport,
	{
		readonly available: () => boolean;
		readonly subscribe: (changed: () => void) => () => void;
		readonly reportOverflow: (omittedCount: number) => void;
		readonly schedule: (delay: number, callback: () => void) => () => void;
	}
>()("@ryot-app/kernel-client/modules/entity-watches/transport/EntityWatchTransport") {
	static readonly layer = Layer.succeed(this, {
		available: () => document.visibilityState !== "hidden" && navigator.onLine,
		reportOverflow: (omittedCount) =>
			console.warn("Entity interest selection omitted IDs", { omittedCount }),
		schedule: (delay, callback) => {
			const timer = setTimeout(callback, delay);
			return () => clearTimeout(timer);
		},
		subscribe: (changed) =>
			subscribeEntityWatchLifecycle(changed, {
				window,
				document,
				listenResume: listenNativeResume,
			}),
	});
}
