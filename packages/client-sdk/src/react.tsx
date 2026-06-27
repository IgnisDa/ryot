import {
	RegistryContext,
	RegistryProvider,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from "@effect/atom-react";
import { SETTLE_RING_DURATION_MS } from "@ryot-app/client-ui-sdk/sync";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useMemo,
	useSyncExternalStore,
	type ReactNode,
} from "react";

import { ActiveScreenContext } from "./active-screen";
import { createEntityRefresh, entityTransport } from "./entity-refresh";
import type { EntityInterest, EntityInterestSubscription, EntityUpdate, RyotClient } from "./index";
import type { PluginRouterNavigation } from "./navigation/store";
import {
	RyotClientService,
	RyotNavigationService,
	RyotScheduleService,
	type RyotRuntime,
	type RyotSchedule,
} from "./schedule";
import { createSettleTracker } from "./settle";

const staleTime = 30 * 1_000;
const idleTTL = 5 * 60 * 1_000;
const queryTypeId = Symbol("@ryot-app/client-sdk/react/query");
const mutationTypeId = Symbol("@ryot-app/client-sdk/react/mutation");
const RyotContext = createContext<
	| {
			readonly client: RyotClient;
			readonly schedule: RyotSchedule;
			readonly navigation: PluginRouterNavigation | undefined;
	  }
	| undefined
>(undefined);

type QueryContext<Input> = {
	readonly input: Input;
	readonly client: RyotClient;
	readonly signal: AbortSignal;
};

type MutationContext<Input> = QueryContext<Input>;

export interface RyotQuery<Input, Data> {
	readonly [queryTypeId]: { readonly data?: Data; readonly input?: Input };
}

export interface RyotMutation<Input, Data> {
	readonly [mutationTypeId]: { readonly data?: Data; readonly input?: Input };
}

export type RyotQueryResult<Data> = {
	readonly isError: boolean;
	readonly isSuccess: boolean;
	readonly isPending: boolean;
	readonly error: Error | null;
	readonly isFetching: boolean;
	readonly refetch: () => void;
	readonly data: Data | undefined;
	readonly status: "pending" | "error" | "success";
};

export type RyotMutationResult<Input, Data> = {
	readonly reset: () => void;
	readonly isPending: boolean;
	readonly error: Error | null;
	readonly data: Data | undefined;
	readonly mutate: (input: Input) => void;
	readonly mutateAsync: (input: Input) => Promise<Data>;
	readonly status: "idle" | "pending" | "error" | "success";
};

const browserFocusSignal = Atom.readable((get) => {
	let version = 0;
	if (typeof window === "undefined" || typeof document === "undefined") {
		return version;
	}
	const onVisibilityChange = () => {
		if (document.visibilityState === "visible") {
			get.setSelf(++version);
		}
	};
	document.addEventListener("visibilitychange", onVisibilityChange);
	get.addFinalizer(() => document.removeEventListener("visibilitychange", onVisibilityChange));
	return version;
});

const asError = (cause: Cause.Cause<unknown>) => {
	const error = Cause.squash(cause);
	return error instanceof Error ? error : new Error(String(error));
};

type RyotQueryOptions<Input, Data> = {
	/** Cancels in-flight work when the final consumer for an input unmounts. */
	readonly cancelOnUnmount?: boolean;
	readonly initialData?: (input: Input) => Data;
	readonly entityInterest?: (context: {
		readonly input: Input;
		readonly data: Data | undefined;
	}) => EntityInterest;
};

const makeQueryAtom = <Data,>(
	run: (signal: AbortSignal) => Promise<Data>,
	initialData?: Data,
	cancelOnUnmount = false,
	interested = false,
) => {
	const request = Effect.tryPromise({
		try: run,
		catch: (error) => (error instanceof Error ? error : new Error(String(error))),
	});
	const hydrated = new WeakSet<AtomRegistry.AtomRegistry>();
	const effect = Effect.flatMap(AtomRegistry.AtomRegistry, (registry) => {
		if (initialData !== undefined && !hydrated.has(registry)) {
			hydrated.add(registry);
			return Effect.promise(() => Promise.resolve(initialData));
		}
		return request;
	});
	const source =
		initialData === undefined
			? Atom.make(request)
			: Atom.make(effect, { initialValue: initialData });
	const requestSource = cancelOnUnmount ? source.pipe(Atom.setIdleTTL(0)) : source;
	if (interested) {
		return requestSource.pipe(Atom.setIdleTTL(cancelOnUnmount ? 0 : idleTTL));
	}
	if (initialData !== undefined) {
		return requestSource;
	}
	return requestSource.pipe(
		Atom.swr({ staleTime, revalidateOnFocus: true, focusSignal: browserFocusSignal }),
		Atom.setIdleTTL(cancelOnUnmount ? 0 : idleTTL),
	);
};

class QueryDefinition<Input, Data> implements RyotQuery<Input, Data> {
	readonly [queryTypeId] = {};

	constructor(
		readonly atom: (client: RyotClient, input: Input) => ReturnType<typeof makeQueryAtom<Data>>,
		readonly entityInterest?: RyotQueryOptions<Input, Data>["entityInterest"],
	) {}
}

class MutationDefinition<Input, Data> implements RyotMutation<Input, Data> {
	readonly [mutationTypeId] = {};

	constructor(readonly run: (context: MutationContext<Input>) => Promise<Data>) {}
}

export function createRyotQuery<Data>(
	query: (context: Omit<QueryContext<void>, "input">) => Promise<Data>,
	options?: RyotQueryOptions<void, Data>,
): RyotQuery<void, Data>;
export function createRyotQuery<Input, Data>(
	query: (context: QueryContext<Input>) => Promise<Data>,
	options?: RyotQueryOptions<Input, Data>,
): RyotQuery<Input, Data>;
export function createRyotQuery<Input, Data>(
	query: (context: QueryContext<Input>) => Promise<Data>,
	options?: RyotQueryOptions<Input, Data>,
) {
	const clients = new WeakMap<
		RyotClient,
		(input: Input) => ReturnType<typeof makeQueryAtom<Data>>
	>();
	return new QueryDefinition<Input, Data>((client, input) => {
		let inputs = clients.get(client);
		if (!inputs) {
			inputs = Atom.family((familyInput: Input) =>
				makeQueryAtom<Data>(
					(signal) => query({ client, input: familyInput, signal }),
					options?.initialData?.(familyInput),
					options?.cancelOnUnmount,
					options?.entityInterest !== undefined,
				),
			);
			clients.set(client, inputs);
		}
		return inputs(input);
	}, options?.entityInterest);
}

export function createRyotMutation<Data>(
	mutation: (context: Omit<MutationContext<void>, "input">) => Promise<Data>,
): RyotMutation<void, Data>;
export function createRyotMutation<Input, Data>(
	mutation: (context: MutationContext<Input>) => Promise<Data>,
): RyotMutation<Input, Data>;
export function createRyotMutation<Input, Data>(
	mutation: (context: MutationContext<Input>) => Promise<Data>,
) {
	return new MutationDefinition(mutation);
}

export const RyotProvider = ({
	runtime,
	children,
}: {
	children: ReactNode;
	runtime: RyotRuntime;
}) => {
	const value = useMemo(
		() =>
			runtime.runSync(
				Effect.all({
					client: RyotClientService,
					schedule: RyotScheduleService,
					// Only a plugin artifact's runtime carries navigation; the kernel host has no router.
					navigation: Effect.map(
						Effect.serviceOption(RyotNavigationService),
						Option.getOrUndefined,
					),
				}),
			),
		[runtime],
	);
	return (
		<RegistryProvider defaultIdleTTL={idleTTL}>
			<RyotContext.Provider value={value}>{children}</RyotContext.Provider>
		</RegistryProvider>
	);
};

export const useRyot = () => {
	const context = useContext(RyotContext);
	if (!context) {
		throw new Error("useRyot must be used within RyotProvider");
	}
	return context.client;
};

export const useRyotSchedule = (): RyotSchedule => {
	const context = useContext(RyotContext);
	if (!context) {
		throw new Error("useRyotSchedule must be used within RyotProvider");
	}
	return context.schedule;
};

/** SDK-internal: `PluginRouter` only. Not a plugin capability, so it stays off `./plugin`. */
export const usePluginNavigation = (): PluginRouterNavigation => {
	const context = useContext(RyotContext);
	if (!context?.navigation) {
		throw new Error("usePluginNavigation must be used within a plugin artifact RyotProvider");
	}
	return context.navigation;
};

export const useRyotTheme = () => {
	const { theme } = useRyot();
	return useSyncExternalStore(theme.subscribe, theme.getSnapshot, theme.getSnapshot);
};

const interestedQueries = new WeakMap<
	AtomRegistry.AtomRegistry,
	WeakMap<object, { users: number; readonly hint: () => void; readonly dispose: () => void } | null>
>();

const useQueryInterest = <Data,>(
	client: RyotClient,
	schedule: RyotSchedule,
	atom: ReturnType<typeof makeQueryAtom<Data>>,
	input: unknown,
	interest?: RyotQueryOptions<unknown, Data>["entityInterest"],
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
			let subscription: EntityInterestSubscription | undefined;
			const refresh = createEntityRefresh(schedule, () => {
				if (registry.get(atom).waiting) {
					refresh.block(true);
					refresh.hint();
				} else {
					registry.refresh(atom);
					refresh.block(registry.get(atom).waiting);
				}
				return Promise.resolve();
			});
			const sync = () => {
				const result = registry.get(atom);
				if (AsyncResult.isSuccess(result)) {
					data = result.value;
				} else if (AsyncResult.isFailure(result) && result.previousSuccess._tag === "Some") {
					data = result.previousSuccess.value.value;
				}
				refresh.block(result.waiting);
				const next = interest({ input: queryInput, data });
				entityTransport(() => {
					if (subscription) {
						subscription.update(next);
					} else {
						subscription = client.entities.watch(next, refresh.hint);
					}
				});
			};
			subscription = entityTransport(() =>
				client.entities.watch(interest({ input: queryInput, data }), refresh.hint),
			);
			const unsubscribe = registry.subscribe(atom, sync);
			registry.get(browserFocusSignal);
			const unfocus = registry.subscribe(browserFocusSignal, () => refresh.hint());
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
					unfocus();
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

const useSettleTracker = () => {
	const schedule = useRyotSchedule();
	const tracker = useMemo(() => createSettleTracker(schedule, SETTLE_RING_DURATION_MS), [schedule]);
	useEffect(() => () => tracker.dispose(), [tracker]);
	const settled = useSyncExternalStore(tracker.subscribe, tracker.snapshot, tracker.snapshot);
	return { settled, tracker };
};

export const useEntitySettle = (interest: EntityInterest) => {
	const client = useRyot();
	const active = useContext(ActiveScreenContext);
	const { settled, tracker } = useSettleTracker();
	const latestInterest = useRef(interest);
	const subscription = useRef<EntityInterestSubscription | undefined>(undefined);
	useEffect(() => {
		latestInterest.current = interest;
	});
	useEffect(() => {
		if (!active) {
			return undefined;
		}
		const watch = entityTransport(() =>
			client.entities.watch(latestInterest.current, tracker.stage),
		);
		subscription.current = watch;
		return () => {
			subscription.current = undefined;
			entityTransport(() => watch?.dispose());
		};
	}, [client, active, tracker]);
	useEffect(() => {
		entityTransport(() => subscription.current?.update(interest));
	}, [interest]);
	return { settled, commit: tracker.commit };
};

export const useEntityRefresh = (options: {
	readonly blocked: boolean;
	readonly identity: string;
	readonly interest: EntityInterest;
	readonly onRefresh: (updates: readonly EntityUpdate[]) => Promise<void>;
}) => {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const active = useContext(ActiveScreenContext);
	const { settled, tracker } = useSettleTracker();
	const latest = useRef(options);
	const previous = useRef({ identity: options.identity, active });
	const controller = useRef<
		| {
				subscription: EntityInterestSubscription | undefined;
				readonly refresh: ReturnType<typeof createEntityRefresh>;
		  }
		| undefined
	>(undefined);
	useEffect(() => {
		latest.current = options;
	});
	useEffect(() => {
		const refresh = createEntityRefresh(schedule, async (updates) => {
			for (const update of updates) {
				tracker.stage(update);
			}
			await latest.current.onRefresh(updates);
			tracker.commit();
		});
		controller.current = { refresh, subscription: undefined };
		return () => {
			controller.current = undefined;
			refresh.dispose();
		};
	}, [client, schedule, options.identity, tracker]);
	useEffect(() => {
		const catchUp =
			previous.current.identity === options.identity && !previous.current.active && active;
		previous.current = { identity: options.identity, active };
		const current = controller.current;
		current?.refresh.block(!active || latest.current.blocked);
		if (!active || !current) {
			return undefined;
		}
		const subscription = entityTransport(() =>
			client.entities.watch(latest.current.interest, current.refresh.hint),
		);
		current.subscription = subscription;
		if (catchUp) {
			current.refresh.hint();
		}
		return () => {
			current.subscription = undefined;
			entityTransport(() => subscription?.dispose());
		};
	}, [client, options.identity, active]);
	useEffect(() => {
		controller.current?.refresh.block(!active || options.blocked);
		entityTransport(() => controller.current?.subscription?.update(options.interest));
	}, [active, options.interest, options.blocked]);
	return { settled };
};

export function useRyotQuery<Data>(query: RyotQuery<void, Data>): RyotQueryResult<Data>;
export function useRyotQuery<Input, Data>(
	query: RyotQuery<Input, Data>,
	input: Input,
): RyotQueryResult<Data>;
export function useRyotQuery<Data>(
	query: RyotQuery<unknown, Data>,
	input?: unknown,
): RyotQueryResult<Data> {
	const client = useRyot();
	const schedule = useRyotSchedule();
	if (!(query instanceof QueryDefinition)) {
		throw new Error("useRyotQuery requires a query created by createRyotQuery");
	}
	const atom = query.atom(client, input);
	useQueryInterest(client, schedule, atom, input, query.entityInterest);
	const result = useAtomValue(atom);
	const refetch = useAtomRefresh(atom);
	const isError = AsyncResult.isFailure(result);
	const isSuccess = AsyncResult.isSuccess(result);
	let data: Data | undefined;
	if (isSuccess) {
		data = result.value;
	} else if (isError && result.previousSuccess._tag === "Some") {
		data = result.previousSuccess.value.value;
	}
	let status: RyotQueryResult<Data>["status"] = "pending";
	if (isSuccess) {
		status = "success";
	} else if (isError) {
		status = "error";
	}
	return {
		data,
		status,
		refetch,
		isError,
		isSuccess,
		isFetching: result.waiting,
		isPending: AsyncResult.isInitial(result),
		error: isError ? asError(result.cause) : null,
	};
}

export const useRyotMutation = <Input, Data>(
	mutation: RyotMutation<Input, Data>,
): RyotMutationResult<Input, Data> => {
	const client = useRyot();
	if (!(mutation instanceof MutationDefinition)) {
		throw new Error("useRyotMutation requires a mutation created by createRyotMutation");
	}
	const atom = useMemo(
		() =>
			Atom.fn<Input>()<Error, Data>((input) =>
				Effect.tryPromise({
					try: (signal) => mutation.run({ client, input, signal }),
					catch: (error) => (error instanceof Error ? error : new Error(String(error))),
				}),
			),
		[client, mutation],
	);
	const result = useAtomValue(atom);
	const set = useAtomSet(atom);
	const execute = useAtomSet(atom, { mode: "promise" });
	const mutateAsync = (input: Input) => execute(input);
	let status: RyotMutationResult<Input, Data>["status"] = "idle";
	if (result.waiting) {
		status = "pending";
	} else if (AsyncResult.isFailure(result)) {
		status = "error";
	} else if (AsyncResult.isSuccess(result)) {
		status = "success";
	}
	return {
		status,
		mutateAsync,
		isPending: result.waiting,
		reset: () => set(Atom.Reset),
		data: AsyncResult.isSuccess(result) ? result.value : undefined,
		error: AsyncResult.isFailure(result) ? asError(result.cause) : null,
		mutate: (input) => {
			void mutateAsync(input).catch(() => undefined);
		},
	};
};
