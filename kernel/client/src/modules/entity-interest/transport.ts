import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Context, Layer } from "effect";

export type InterestSocket = Pick<EventTarget, "addEventListener"> & {
	close(): void;
	send(frame: string): void;
};

export const subscribeEntityInterestLifecycle = (
	changed: () => void,
	platform: {
		readonly window: EventTarget;
		readonly document: EventTarget;
		readonly listenResume: (notify: () => void) => Promise<PluginListenerHandle> | undefined;
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
	const native = platform.listenResume(notify);
	void native?.catch(() => undefined);
	return () => {
		if (disposed) {
			return;
		}
		disposed = true;
		platform.document.removeEventListener("visibilitychange", notify);
		platform.window.removeEventListener("offline", notify);
		platform.window.removeEventListener("online", notify);
		void native?.then((listener) => listener.remove()).catch(() => undefined);
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
				listenResume: (notify) =>
					Capacitor.isNativePlatform() ? App.addListener("resume", notify) : undefined,
			}),
	});
}
