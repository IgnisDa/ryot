import { RegistryContext } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useEffect } from "react";

import { ActiveScreenContext } from "../active-screen";
import type { makeQueryAtom } from "../queries/definitions";
import { PageRefreshRegistryContext, type PageRefreshRegistry } from "./page-registry";

const pageQueries = new WeakMap<
	AtomRegistry.AtomRegistry,
	WeakMap<
		object,
		{
			users: number;
			pending: boolean;
			readonly hint: () => void;
			readonly dispose: () => void;
		} | null
	>
>();
const pageQueryGenerations = new WeakMap<
	AtomRegistry.AtomRegistry,
	WeakMap<object, { registry: PageRefreshRegistry; generation: number }>
>();

export const useQueryPageRefresh = <Data, Failure extends Error>(
	atom: ReturnType<typeof makeQueryAtom<Data, Failure>>,
	refreshOnMutation: boolean,
	catchUp: boolean,
) => {
	const active = useContext(ActiveScreenContext);
	const registry = useContext(RegistryContext);
	const pageRegistry = useContext(PageRefreshRegistryContext);
	useEffect(() => {
		if (!pageRegistry || !refreshOnMutation) {
			return undefined;
		}
		let generations = pageQueryGenerations.get(registry);
		if (!generations) {
			generations = new WeakMap();
			pageQueryGenerations.set(registry, generations);
		}
		let consumed = generations.get(atom);
		if (consumed?.registry !== pageRegistry) {
			consumed = { registry: pageRegistry, generation: pageRegistry.generation() };
			generations.set(atom, consumed);
		}
		if (!active) {
			return undefined;
		}
		if (!catchUp) {
			consumed.generation = pageRegistry.generation();
		}
		let controllers = pageQueries.get(registry);
		if (!controllers) {
			controllers = new WeakMap();
			pageQueries.set(registry, controllers);
		}
		let controller = controllers.get(atom);
		if (!controller) {
			const current = {
				users: 0,
				pending: false,
				dispose: () => undefined,
				hint: () => {
					if (registry.get(atom).waiting) {
						current.pending = true;
					} else {
						registry.refresh(atom);
					}
				},
			};
			const unsubscribe = registry.subscribe(atom, () => {
				if (current.pending && !registry.get(atom).waiting) {
					current.pending = false;
					registry.refresh(atom);
				}
			});
			const invoke = () =>
				Effect.sync(() => {
					consumed.generation = pageRegistry.generation();
					current.hint();
				});
			const unregister = pageRegistry.register(invoke, consumed.generation);
			current.dispose = () => {
				unregister();
				unsubscribe();
			};
			controller = current;
			controllers.set(atom, controller);
		}
		controller.users++;
		return () => {
			if (--controller.users === 0) {
				controller.dispose();
				controllers.set(atom, null);
			}
		};
	}, [active, atom, catchUp, pageRegistry, refreshOnMutation, registry]);
};
