import { RyotClientError } from "./index";

export const entityTransport = <A>(run: () => A) => {
	try {
		return run();
	} catch (error) {
		if (
			!(error instanceof RyotClientError) ||
			(error.reason !== "transport" && error.reason !== "disposed")
		) {
			throw error;
		}
		return undefined;
	}
};

export const createEntityRefresh = (refresh: () => Promise<void>) => {
	let dirty = false;
	let running = false;
	let blocked = false;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		if (disposed || !dirty || blocked || running || timer !== undefined) {
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			if (disposed || blocked || running || !dirty) {
				return;
			}
			dirty = false;
			running = true;
			void Promise.resolve()
				.then(() => {
					if (disposed) {
						return undefined;
					}
					if (blocked) {
						dirty = true;
						return undefined;
					}
					return refresh();
				})
				.catch(() => undefined)
				.finally(() => {
					running = false;
					schedule();
				});
		}, 250);
	};
	return {
		hint: () => {
			dirty = true;
			schedule();
		},
		block: (value: boolean) => {
			blocked = value;
			schedule();
		},
		dispose: () => {
			disposed = true;
			dirty = false;
			clearTimeout(timer);
		},
	};
};
