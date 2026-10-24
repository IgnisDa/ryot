import { RegistryContext } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useEffect, useRef } from "react";

import { ActiveScreenContext } from "../active-screen";
import type { EntityWatchSubscription } from "../client/adapter";
import type { RyotClient } from "../client/client";
import type { makeQueryAtom, RyotQueryOptions } from "../queries/definitions";
import type { RyotSchedule } from "../schedule";
import { createEntityRefresh, entityTransport } from "./entity-refresh";
import { type PageRefreshRegistry, PageRefreshRegistryContext } from "./page-registry";

type PageGeneration = { generation: number };
type QueryRefresh = {
	users: number;
	readonly hint: () => void;
	readonly retainPage: (page: PageRefreshRegistry, consumed: PageGeneration) => () => void;
	readonly dispose: () => void;
};

const queries = new WeakMap<AtomRegistry.AtomRegistry, WeakMap<object, QueryRefresh | null>>();
const pageGenerations = new WeakMap<
	AtomRegistry.AtomRegistry,
	WeakMap<object, WeakMap<PageRefreshRegistry, PageGeneration>>
>();

const retainQueryRefresh = <Data, Failure extends Error>(
	registry: AtomRegistry.AtomRegistry,
	client: RyotClient,
	schedule: RyotSchedule,
	atom: ReturnType<typeof makeQueryAtom<Data, Failure>>,
	queryInput: unknown,
	interest: RyotQueryOptions<unknown, Data>["entityWatch"],
) => {
	let controllers = queries.get(registry);
	if (!controllers) {
		controllers = new WeakMap();
		queries.set(registry, controllers);
	}
	let controller = controllers.get(atom);
	const remount =
		!controller && controllers.has(atom) && !AsyncResult.isInitial(registry.get(atom));
	if (!controller) {
		let data: Data | undefined;
		let subscription: EntityWatchSubscription | undefined;
		const refresh = createEntityRefresh(schedule, () =>
			Effect.sync(() => {
				if (registry.get(atom).waiting) {
					refresh.block(true);
					refresh.hint();
				} else {
					registry.refresh(atom);
					refresh.block(registry.get(atom).waiting);
				}
			}),
		);
		const sync = () => {
			const result = registry.get(atom);
			if (interest) {
				if (AsyncResult.isSuccess(result)) {
					data = result.value;
				} else if (AsyncResult.isFailure(result) && result.previousSuccess._tag === "Some") {
					data = result.previousSuccess.value.value;
				}
				const next = interest({ data, input: queryInput });
				entityTransport(() => {
					if (subscription) {
						subscription.update(next);
					} else {
						subscription = client.entities.watch(next, refresh.hint);
					}
				});
			}
			refresh.block(result.waiting);
		};
		const unsubscribe = registry.subscribe(atom, sync);
		sync();
		const pages = new Map<PageRefreshRegistry, { users: number; unregister: () => void }>();
		controller = {
			users: 0,
			hint: refresh.hint,
			dispose: () => {
				refresh.dispose();
				unsubscribe();
				entityTransport(() => subscription?.dispose());
			},
			retainPage: (page, generation) => {
				let registration = pages.get(page);
				if (!registration) {
					registration = {
						users: 0,
						unregister: page.register(
							() =>
								Effect.sync(() => {
									generation.generation = page.generation();
									// Page demand has already passed through the page registry's batch window.
									refresh.hintNow();
								}),
							generation.generation,
						),
					};
					pages.set(page, registration);
				}
				registration.users++;
				return () => {
					if (--registration.users === 0) {
						registration.unregister();
						pages.delete(page);
					}
				};
			},
		};
		controllers.set(atom, controller);
	}
	controller.users++;
	return {
		remount,
		controller,
		release: () => {
			if (--controller.users === 0) {
				controller.dispose();
				controllers.set(atom, null);
			}
		},
	};
};

export const useQueryRefresh = <Data, Failure extends Error>(
	client: RyotClient,
	schedule: RyotSchedule,
	atom: ReturnType<typeof makeQueryAtom<Data, Failure>>,
	input: unknown,
	interest: RyotQueryOptions<unknown, Data>["entityWatch"],
	refreshOnMutation: boolean,
) => {
	const active = useContext(ActiveScreenContext);
	const registry = useContext(RegistryContext);
	const pageRegistry = useContext(PageRefreshRegistryContext);
	const previous = useRef({ atom, active, attached: false });
	const latestInput = useRef(input);
	useEffect(() => {
		latestInput.current = input;
	});
	useEffect(() => {
		const reattach =
			previous.current.attached && previous.current.atom === atom && previous.current.active;
		const catchUp = previous.current.atom === atom && !previous.current.active && active;
		previous.current = { atom, active, attached: true };
		if (!active || !interest) {
			return undefined;
		}
		const { remount, release, controller } = retainQueryRefresh(
			registry,
			client,
			schedule,
			atom,
			latestInput.current,
			interest,
		);
		if ((remount && !reattach) || catchUp) {
			controller.hint();
		}
		return release;
	}, [active, atom, client, interest, registry, schedule]);
	useEffect(() => {
		if (!pageRegistry || !refreshOnMutation) {
			return undefined;
		}
		let atoms = pageGenerations.get(registry);
		if (!atoms) {
			atoms = new WeakMap();
			pageGenerations.set(registry, atoms);
		}
		let pages = atoms.get(atom);
		if (!pages) {
			pages = new WeakMap();
			atoms.set(atom, pages);
		}
		let consumed = pages.get(pageRegistry);
		if (!consumed) {
			consumed = { generation: pageRegistry.generation() };
			pages.set(pageRegistry, consumed);
		}
		if (!active) {
			return undefined;
		}
		if (interest) {
			consumed.generation = pageRegistry.generation();
		}
		const { release, controller } = retainQueryRefresh(
			registry,
			client,
			schedule,
			atom,
			latestInput.current,
			interest,
		);
		const releasePage = controller.retainPage(pageRegistry, consumed);
		return () => {
			releasePage();
			release();
		};
	}, [active, atom, client, interest, pageRegistry, refreshOnMutation, registry, schedule]);
};
