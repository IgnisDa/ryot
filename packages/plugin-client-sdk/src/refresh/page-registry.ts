import { RegistryContext } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useContext, useEffect, useEffectEvent, useRef } from "react";

import { ActiveScreenContext } from "../active-screen";
import type { RyotSchedule } from "../schedule";
import { createEntityRefresh } from "./entity-refresh";

export type PageRefreshHandle = () => Effect.Effect<void>;
export type PageRefreshRegistry = {
	readonly generation: () => number;
	readonly hint: () => void;
	readonly register: (handle: PageRefreshHandle, consumedGeneration?: number) => () => void;
};
export type ManagedPageRefreshRegistry = PageRefreshRegistry & {
	readonly activate: () => void;
	readonly dispose: () => void;
};

export const PageRefreshRegistryContext = createContext<PageRefreshRegistry | undefined>(undefined);

const browserFocusSignal = Atom.readable((get) => {
	let version = 0;
	if (typeof window === "undefined" || typeof document === "undefined") {
		return version;
	}
	const ownerDocument = document;
	const onVisibilityChange = () => {
		if (ownerDocument.visibilityState === "visible") {
			get.setSelf(++version);
		}
	};
	ownerDocument.addEventListener("visibilitychange", onVisibilityChange);
	get.addFinalizer(() => ownerDocument.removeEventListener("visibilitychange", onVisibilityChange));
	return version;
});

export const createPageRefreshRegistry = (schedule: RyotSchedule): ManagedPageRefreshRegistry => {
	const handles = new Set<PageRefreshHandle>();
	const catchUps = new Set<PageRefreshHandle>();
	let generation = 0;
	let refreshAll = false;
	const run = () => {
		const selected = refreshAll
			? [...handles]
			: [...catchUps].filter((handle) => handles.has(handle));
		refreshAll = false;
		catchUps.clear();
		return Effect.forEach(selected, (handle) => Effect.suspend(handle), {
			discard: true,
			concurrency: "unbounded",
		});
	};
	let refresh = createEntityRefresh(schedule, run);
	let disposed = false;
	return {
		generation: () => generation,
		hint: () => {
			generation++;
			refreshAll = true;
			refresh.hint();
		},
		dispose: () => {
			disposed = true;
			handles.clear();
			catchUps.clear();
			refreshAll = false;
			refresh.dispose();
		},
		activate: () => {
			if (disposed) {
				refresh = createEntityRefresh(schedule, run);
				disposed = false;
				if (refreshAll || catchUps.size > 0) {
					refresh.hint();
				}
			}
		},
		register: (handle: PageRefreshHandle, consumedGeneration?: number) => {
			handles.add(handle);
			if (consumedGeneration !== undefined && consumedGeneration !== generation) {
				catchUps.add(handle);
				refresh.hint();
			}
			return () => {
				handles.delete(handle);
				catchUps.delete(handle);
			};
		},
	};
};

export const PageRefreshLifecycle = () => {
	const registry = useContext(RegistryContext);
	const pageRegistry = useContext(PageRefreshRegistryContext);
	useEffect(() => {
		if (!pageRegistry) {
			return undefined;
		}
		registry.get(browserFocusSignal);
		return registry.subscribe(browserFocusSignal, pageRegistry.hint);
	}, [pageRegistry, registry]);
	return null;
};

export const usePageRefresh = (handle: PageRefreshHandle) => {
	const active = useContext(ActiveScreenContext);
	const registry = useContext(PageRefreshRegistryContext);
	const refresh = useEffectEvent(handle);
	const consumed = useRef<{ registry: PageRefreshRegistry; generation: number } | undefined>(
		undefined,
	);
	useEffect(() => {
		if (!registry) {
			return undefined;
		}
		if (consumed.current?.registry !== registry) {
			consumed.current = { registry, generation: registry.generation() };
		}
		if (!active) {
			return undefined;
		}
		const invoke = () => {
			if (consumed.current?.registry === registry) {
				consumed.current.generation = registry.generation();
			}
			return refresh();
		};
		return registry.register(invoke, consumed.current.generation);
	}, [active, registry]);
};

export const usePageRefreshRequest = () => {
	const registry = useContext(PageRefreshRegistryContext);
	if (!registry) {
		throw new Error("usePageRefreshRequest must be used within RyotProvider");
	}
	return registry.hint;
};
