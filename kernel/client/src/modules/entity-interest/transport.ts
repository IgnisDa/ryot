import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { type Cause, Context, Effect, Fiber, Layer } from "effect";

export type InterestSocket = Pick<EventTarget, "addEventListener"> & {
	close(): void;
	send(frame: string): void;
};

type ListenNativeResume = (
	notify: () => void,
) => Effect.Effect<PluginListenerHandle | undefined, Cause.UnknownError>;

const listenNativeResume: ListenNativeResume = (notify) =>
	Capacitor.isNativePlatform()
		? Effect.tryPromise(() => App.addListener("resume", notify))
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
					listener === undefined ? Effect.void : Effect.tryPromise(() => listener.remove()),
				),
				Effect.ignore,
			),
		);
	};
};

export const subscribeEntityInterestLifecycle = (
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

export class EntityInterestTransport extends Context.Service<
	EntityInterestTransport,
	{
		readonly available: () => boolean;
		readonly open: (url: string) => InterestSocket;
		readonly subscribe: (changed: () => void) => () => void;
		readonly reportOverflow: (omittedCount: number) => void;
		readonly schedule: (delay: number, callback: () => void) => () => void;
	}
>()("EntityInterestTransport") {
	static readonly layer = Layer.succeed(this, {
		open: (url) => new WebSocket(url),
		available: () => document.visibilityState !== "hidden" && navigator.onLine,
		reportOverflow: (omittedCount) =>
			console.warn("Entity interest selection omitted IDs", { omittedCount }),
		schedule: (delay, callback) => {
			const timer = setTimeout(callback, delay);
			return () => clearTimeout(timer);
		},
		subscribe: (changed) =>
			subscribeEntityInterestLifecycle(changed, {
				window,
				document,
				listenResume: listenNativeResume,
			}),
	});
}
