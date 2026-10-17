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

const interestedQueries = new WeakMap<
	AtomRegistry.AtomRegistry,
	WeakMap<object, { users: number; readonly hint: () => void; readonly dispose: () => void } | null>
>();

export const useQueryInterest = <Data, Failure extends Error>(
	client: RyotClient,
	schedule: RyotSchedule,
	atom: ReturnType<typeof makeQueryAtom<Data, Failure>>,
	input: unknown,
	interest?: RyotQueryOptions<unknown, Data>["entityWatch"],
) => {
	const active = useContext(ActiveScreenContext);
	const registry = useContext(RegistryContext);
	const previous = useRef({ atom, active, attached: false });
	const latestInput = useRef(input);
	useEffect(() => {
		latestInput.current = input;
	});
	useEffect(() => {
		const queryInput = latestInput.current;
		const reattach =
			previous.current.attached && previous.current.atom === atom && previous.current.active;
		const catchUp = previous.current.atom === atom && !previous.current.active && active;
		previous.current = { atom, active, attached: true };
		if (!interest || !active) {
			return undefined;
		}
		let controllers = interestedQueries.get(registry);
		if (!controllers) {
			controllers = new WeakMap();
			interestedQueries.set(registry, controllers);
		}
		let controller = controllers.get(atom);
		if (!controller) {
			const remount =
				!reattach && controllers.has(atom) && !AsyncResult.isInitial(registry.get(atom));
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
				if (AsyncResult.isSuccess(result)) {
					data = result.value;
				} else if (AsyncResult.isFailure(result) && result.previousSuccess._tag === "Some") {
					data = result.previousSuccess.value.value;
				}
				refresh.block(result.waiting);
				const next = interest({ data, input: queryInput });
				entityTransport(() => {
					if (subscription) {
						subscription.update(next);
					} else {
						subscription = client.entities.watch(next, refresh.hint);
					}
				});
			};
			subscription = entityTransport(() =>
				client.entities.watch(interest({ data, input: queryInput }), refresh.hint),
			);
			const unsubscribe = registry.subscribe(atom, sync);
			sync();
			if (remount) {
				refresh.hint();
			}
			controller = {
				users: 0,
				hint: refresh.hint,
				dispose: () => {
					refresh.dispose();
					unsubscribe();
					entityTransport(() => subscription?.dispose());
				},
			};
			controllers.set(atom, controller);
		}
		controller.users++;
		if (catchUp) {
			controller.hint();
		}
		return () => {
			if (--controller.users === 0) {
				controller.dispose();
				controllers.set(atom, null);
			}
		};
	}, [client, schedule, registry, atom, interest, active]);
};
