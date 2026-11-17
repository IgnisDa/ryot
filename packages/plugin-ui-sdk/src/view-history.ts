export type ViewChange = "new" | "same" | "initial" | "restore";

export type ViewEntry = { readonly key: string; readonly identity: string };

export type ViewHistory<State> = {
	readonly enter: (next: ViewEntry) => ViewChange;
	readonly save: (entry: ViewEntry, state: State) => void;
	readonly saved: (entry: ViewEntry) => State | undefined;
};

const VIEW_HISTORY_LIMIT = 64;

const USER_SCROLL_INTENTS = ["wheel", "keydown", "touchstart", "pointerdown"] as const;

/** Scrolls to `top` and keeps retrying while content grows, until reached or the reader scrolls. */
export function restoreScrollTop(element: HTMLElement, top: number): () => void {
	const apply = () => {
		element.scrollTop = top;
		return element.scrollTop >= top - 1;
	};
	if (apply() || typeof ResizeObserver === "undefined") {
		return () => undefined;
	}
	const resizes = new ResizeObserver(() => {
		if (apply()) {
			stop();
		}
	});
	const observeChildren = () => {
		for (const child of element.children) {
			resizes.observe(child);
		}
	};
	const insertions = new MutationObserver(observeChildren);
	function stop() {
		resizes.disconnect();
		insertions.disconnect();
		for (const intent of USER_SCROLL_INTENTS) {
			element.removeEventListener(intent, stop);
		}
	}
	observeChildren();
	insertions.observe(element, { childList: true });
	for (const intent of USER_SCROLL_INTENTS) {
		element.addEventListener(intent, stop, { passive: true });
	}
	return stop;
}

export function createViewHistory<State>(): ViewHistory<State> {
	let active: undefined | ViewEntry;
	const states = new Map<string, { readonly state: State; readonly identity: string }>();

	const saved = (entry: ViewEntry) => {
		const remembered = states.get(entry.key);
		return remembered?.identity === entry.identity ? remembered.state : undefined;
	};

	return {
		saved,
		save: (entry, state) => {
			states.delete(entry.key);
			states.set(entry.key, { state, identity: entry.identity });
			for (const key of states.keys()) {
				if (states.size <= VIEW_HISTORY_LIMIT) {
					break;
				}
				states.delete(key);
			}
		},
		enter: (next) => {
			const previous = active;
			active = next;
			if (previous === undefined) {
				return "initial";
			}
			if (next.key !== previous.key && states.get(next.key)?.identity === next.identity) {
				return "restore";
			}
			return next.identity === previous.identity ? "same" : "new";
		},
	};
}
