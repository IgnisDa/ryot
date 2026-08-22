import {
	RegistryContext,
	RegistryProvider,
	useAtomRefresh,
	useAtomSet,
	useAtomValue,
} from "@effect/atom-react";
import { OverlayBackProvider } from "@ryot-app/client-ui-sdk";
import { SETTLE_RING_DURATION_MS } from "@ryot-app/client-ui-sdk/sync";
import { MANAGED_ASSET_RESOLUTION_MAX_ASSETS } from "@ryot-app/contract/modules/uploads/schemas";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";

import { ActiveScreenContext } from "./active-screen";
import { createEntityRefresh, entityTransport } from "./entity-refresh";
import type {
	EntityInterest,
	EntityInterestSubscription,
	EntityUpdate,
	ManagedAssetLocator,
	ManagedAssetResolution,
	RyotClient,
} from "./index";
import type { PluginRouterNavigation } from "./navigation/store";
import {
	RyotClientService,
	RyotNavigationService,
	RyotScheduleService,
	type RyotRuntime,
	type RyotSchedule,
} from "./schedule";
import { createSettleTracker } from "./settle";

export { ActiveScreenContext };

const staleTime = 30 * 1_000;
const idleTTL = 5 * 60 * 1_000;
const queryTypeId = Symbol("@ryot-app/client-sdk/react/query");
const mutationTypeId = Symbol("@ryot-app/client-sdk/react/mutation");
type PageRefreshHandle = () => void | Promise<void>;
type PageRefreshRegistry = {
	readonly generation: () => number;
	readonly hint: () => void;
	readonly register: (handle: PageRefreshHandle, consumedGeneration?: number) => () => void;
};
type ManagedPageRefreshRegistry = PageRefreshRegistry & {
	readonly activate: () => void;
	readonly dispose: () => void;
};
const PageRefreshRegistryContext = createContext<PageRefreshRegistry | undefined>(undefined);
const RyotContext = createContext<
	| {
			readonly client: RyotClient;
			readonly hostServices: unknown;
			readonly schedule: RyotSchedule;
			readonly navigation: PluginRouterNavigation | undefined;
	  }
	| undefined
>(undefined);

type QueryContext<Input, HostServices> = {
	readonly input: Input;
	readonly client: RyotClient;
	readonly signal: AbortSignal;
	readonly hostServices: HostServices;
};

type MutationContext<Input, HostServices> = QueryContext<Input, HostServices>;

export interface RyotQuery<Input, Data, HostServices = undefined> {
	readonly [queryTypeId]: {
		readonly data?: Data;
		readonly input?: Input;
		readonly hostServices?: HostServices;
	};
}

export interface RyotMutation<Input, Data, HostServices = undefined> {
	readonly [mutationTypeId]: {
		readonly data?: Data;
		readonly input?: Input;
		readonly hostServices?: HostServices;
	};
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

export type RyotQueryHookOptions = {
	readonly refreshOnMutation?: boolean;
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
		Atom.swr({ staleTime }),
		Atom.setIdleTTL(cancelOnUnmount ? 0 : idleTTL),
	);
};

class QueryDefinition<Input, Data, HostServices> implements RyotQuery<Input, Data, HostServices> {
	readonly [queryTypeId] = {};

	constructor(
		readonly atom: (
			registry: AtomRegistry.AtomRegistry,
			client: RyotClient,
			hostServices: HostServices,
			input: Input,
		) => ReturnType<typeof makeQueryAtom<Data>>,
		readonly entityInterest?: RyotQueryOptions<Input, Data>["entityInterest"],
	) {}
}

class MutationDefinition<Input, Data, HostServices> implements RyotMutation<
	Input,
	Data,
	HostServices
> {
	readonly [mutationTypeId] = {};

	constructor(readonly run: (context: MutationContext<Input, HostServices>) => Promise<Data>) {}
}

export function createRyotQuery<Data>(
	query: (context: Omit<QueryContext<void, undefined>, "input">) => Promise<Data>,
	options?: RyotQueryOptions<void, Data>,
): RyotQuery<void, Data>;
export function createRyotQuery<Input, Data, HostServices = undefined>(
	query: (context: QueryContext<Input, HostServices>) => Promise<Data>,
	options?: RyotQueryOptions<Input, Data>,
): RyotQuery<Input, Data, HostServices>;
export function createRyotQuery<Input, Data, HostServices = undefined>(
	query: (context: QueryContext<Input, HostServices>) => Promise<Data>,
	options?: RyotQueryOptions<Input, Data>,
) {
	type ClientQueries = {
		hostServices: HostServices;
		readonly inputs: (input: Input) => ReturnType<typeof makeQueryAtom<Data>>;
	};
	const registries = new WeakMap<AtomRegistry.AtomRegistry, WeakMap<RyotClient, ClientQueries>>();
	return new QueryDefinition<Input, Data, HostServices>((registry, client, hostServices, input) => {
		let clients = registries.get(registry);
		if (!clients) {
			clients = new WeakMap();
			registries.set(registry, clients);
		}
		let clientQueries = clients.get(client);
		if (!clientQueries) {
			const current: ClientQueries = {
				hostServices,
				inputs: Atom.family((familyInput: Input) =>
					makeQueryAtom<Data>(
						(signal) =>
							query({ client, input: familyInput, signal, hostServices: current.hostServices }),
						options?.initialData?.(familyInput),
						options?.cancelOnUnmount,
						options?.entityInterest !== undefined,
					),
				),
			};
			clientQueries = current;
			clients.set(client, clientQueries);
		}
		clientQueries.hostServices = hostServices;
		return clientQueries.inputs(input);
	}, options?.entityInterest);
}

export function createRyotMutation<Data>(
	mutation: (context: Omit<MutationContext<void, undefined>, "input">) => Promise<Data>,
): RyotMutation<void, Data>;
export function createRyotMutation<Input, Data, HostServices = undefined>(
	mutation: (context: MutationContext<Input, HostServices>) => Promise<Data>,
): RyotMutation<Input, Data, HostServices>;
export function createRyotMutation<Input, Data, HostServices = undefined>(
	mutation: (context: MutationContext<Input, HostServices>) => Promise<Data>,
) {
	return new MutationDefinition(mutation);
}

export const RyotProvider = ({
	runtime,
	children,
	hostServices,
}: {
	children: ReactNode;
	runtime: RyotRuntime;
	readonly hostServices?: unknown;
}) => {
	const runtimeValue = useMemo(
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
	const value = useMemo(() => ({ ...runtimeValue, hostServices }), [runtimeValue, hostServices]);
	const refreshRegistry = useMemo<ManagedPageRefreshRegistry>(() => {
		const handles = new Set<PageRefreshHandle>();
		const catchUps = new Set<PageRefreshHandle>();
		let generation = 0;
		let refreshAll = false;
		const run = async () => {
			const selected = refreshAll
				? [...handles]
				: [...catchUps].filter((handle) => handles.has(handle));
			refreshAll = false;
			catchUps.clear();
			await Promise.all(selected.map((handle) => Promise.resolve().then(handle)));
		};
		let refresh = createEntityRefresh(value.schedule, run);
		let disposed = false;
		return {
			generation: () => generation,
			hint: () => {
				generation++;
				refreshAll = true;
				refresh.hint();
			},
			activate: () => {
				if (disposed) {
					refresh = createEntityRefresh(value.schedule, run);
					disposed = false;
					if (refreshAll || catchUps.size > 0) {
						refresh.hint();
					}
				}
			},
			dispose: () => {
				disposed = true;
				handles.clear();
				catchUps.clear();
				refreshAll = false;
				refresh.dispose();
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
	}, [value.schedule]);
	useEffect(() => {
		refreshRegistry.activate();
		const unsubscribe = value.client.mutationCompleted.subscribe(refreshRegistry.hint);
		return () => {
			unsubscribe();
			refreshRegistry.dispose();
		};
	}, [refreshRegistry, value.client]);
	return (
		<RegistryProvider defaultIdleTTL={idleTTL}>
			<RyotContext.Provider value={value}>
				<OverlayBackProvider adapter={value.client.overlayBack}>
					<PageRefreshRegistryContext.Provider value={refreshRegistry}>
						<PageRefreshLifecycle />
						{children}
					</PageRefreshRegistryContext.Provider>
				</OverlayBackProvider>
			</RyotContext.Provider>
		</RegistryProvider>
	);
};

const PageRefreshLifecycle = () => {
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

const useQueryPageRefresh = <Data,>(
	atom: ReturnType<typeof makeQueryAtom<Data>>,
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
				hint: () => {
					if (registry.get(atom).waiting) {
						current.pending = true;
					} else {
						registry.refresh(atom);
					}
				},
				dispose: () => undefined,
			};
			const unsubscribe = registry.subscribe(atom, () => {
				if (current.pending && !registry.get(atom).waiting) {
					current.pending = false;
					registry.refresh(atom);
				}
			});
			const invoke = () => {
				consumed.generation = pageRegistry.generation();
				current.hint();
			};
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

export function useRyotQuery<Data, HostServices>(
	query: RyotQuery<void, Data, HostServices>,
	input?: void,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data>;
export function useRyotQuery<Input, Data, HostServices>(
	query: RyotQuery<Input, Data, HostServices>,
	input: Input,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data>;
export function useRyotQuery<Data, HostServices>(
	query: RyotQuery<unknown, Data, HostServices>,
	input?: unknown,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data> {
	const context = useContext(RyotContext);
	const registry = useContext(RegistryContext);
	if (!context) {
		throw new Error("useRyotQuery must be used within RyotProvider");
	}
	const { client, hostServices, schedule } = context;
	if (!(query instanceof QueryDefinition)) {
		throw new Error("useRyotQuery requires a query created by createRyotQuery");
	}
	// The definition declares the host type; React context cannot link that generic to a provider.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const atom = query.atom(registry, client, hostServices as HostServices, input);
	useQueryInterest(client, schedule, atom, input, query.entityInterest);
	const result = useAtomValue(atom);
	const refetch = useAtomRefresh(atom);
	useQueryPageRefresh(
		atom,
		options?.refreshOnMutation !== false,
		query.entityInterest === undefined,
	);
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

export const useRyotMutation = <Input, Data, HostServices>(
	mutation: RyotMutation<Input, Data, HostServices>,
): RyotMutationResult<Input, Data> => {
	const context = useContext(RyotContext);
	if (!context) {
		throw new Error("useRyotMutation must be used within RyotProvider");
	}
	const { client, hostServices } = context;
	// The definition declares the host type; React context cannot link that generic to a provider.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const typedHostServices = hostServices as HostServices;
	const latestHostServices = useRef(typedHostServices);
	latestHostServices.current = typedHostServices;
	if (!(mutation instanceof MutationDefinition)) {
		throw new Error("useRyotMutation requires a mutation created by createRyotMutation");
	}
	const atom = useMemo(
		() =>
			Atom.fn<Input>()<Error, Data>((input) =>
				Effect.tryPromise({
					try: (signal) =>
						mutation.run({ client, input, signal, hostServices: latestHostServices.current }),
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

const ASSET_REFRESH_LEAD_MS = 60_000;

export const managedAssetKey = (locator: ManagedAssetLocator) => `${locator.type}:${locator.key}`;

const sortedManagedAssetLocators = (locators: readonly ManagedAssetLocator[]) =>
	[...locators].sort((left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)));

export const canonicalAssetBatchKey = (locators: readonly ManagedAssetLocator[]) =>
	JSON.stringify(sortedManagedAssetLocators(locators));

export type ManagedAssetBatch = {
	readonly key: string;
	readonly locators: readonly ManagedAssetLocator[];
};

export const managedAssetBatches = (
	locators: readonly ManagedAssetLocator[],
): readonly ManagedAssetBatch[] => {
	const deduped = sortedManagedAssetLocators([
		...new Map(locators.map((locator) => [managedAssetKey(locator), locator])).values(),
	]);
	const batches: ManagedAssetBatch[] = [];
	for (let index = 0; index < deduped.length; index += MANAGED_ASSET_RESOLUTION_MAX_ASSETS) {
		const slice = deduped.slice(index, index + MANAGED_ASSET_RESOLUTION_MAX_ASSETS);
		batches.push({ key: canonicalAssetBatchKey(slice), locators: slice });
	}
	return batches;
};

const useStableManagedAssetLocators = (locators: readonly ManagedAssetLocator[]) => {
	const key = canonicalAssetBatchKey(locators);
	const ref = useRef<
		{ readonly key: string; readonly locators: readonly ManagedAssetLocator[] } | undefined
	>(undefined);
	if (ref.current?.key !== key) {
		ref.current = { key, locators };
	}
	return ref.current.locators;
};

const managedAssetBatchQuery = createRyotQuery<string, readonly ManagedAssetResolution[]>(
	({ client, input, signal }) => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The key is created only from schema-validated locator values.
		const locators = JSON.parse(input) as readonly ManagedAssetLocator[];
		return client.assets.resolve(locators, { signal });
	},
	{ cancelOnUnmount: true },
);

const ManagedAssetUrlsContext = createContext<ReadonlyMap<string, string>>(new Map());

function ManagedAssetBatchResolver(props: {
	readonly batchKey: string;
	readonly onResolved: (batchKey: string, urls: ReadonlyMap<string, string>) => void;
}) {
	const schedule = useRyotSchedule();
	const result = useRyotQuery(managedAssetBatchQuery, props.batchKey);
	const refresh = useEffectEvent(() => result.refetch());
	const publish = useEffectEvent((urls: ReadonlyMap<string, string>) =>
		props.onResolved(props.batchKey, urls),
	);
	const resolutions = result.data;

	useEffect(() => {
		publish(
			new Map(
				(resolutions ?? []).map((resolution) => [
					managedAssetKey(resolution.asset),
					resolution.url,
				]),
			),
		);
	}, [resolutions]);

	useEffect(() => {
		if (resolutions === undefined || resolutions.length === 0) {
			return undefined;
		}
		const earliestExpiry = Math.min(
			...resolutions.map((resolution) => Date.parse(resolution.expiresAt)),
		);
		return schedule.after(
			Math.max(ASSET_REFRESH_LEAD_MS, earliestExpiry - ASSET_REFRESH_LEAD_MS - schedule.now()),
			refresh,
		);
	}, [resolutions, schedule]);

	return null;
}

export function ManagedAssetProvider(props: {
	readonly assets: readonly ManagedAssetLocator[];
	readonly children: ReactNode;
}) {
	const parentUrls = useContext(ManagedAssetUrlsContext);
	const stableAssets = useStableManagedAssetLocators(props.assets);
	const batches = useMemo(() => managedAssetBatches(stableAssets), [stableAssets]);
	const [resolvedBatches, setResolvedBatches] = useState<
		ReadonlyMap<string, ReadonlyMap<string, string>>
	>(new Map());

	const onResolved = useCallback((batchKey: string, urls: ReadonlyMap<string, string>) => {
		setResolvedBatches((previous) => new Map(previous).set(batchKey, urls));
	}, []);

	const urls = useMemo(() => {
		const merged = new Map(parentUrls);
		for (const batch of batches) {
			for (const [key, url] of resolvedBatches.get(batch.key) ?? []) {
				merged.set(key, url);
			}
		}
		return merged;
	}, [parentUrls, batches, resolvedBatches]);

	return (
		<ManagedAssetUrlsContext.Provider value={urls}>
			{batches.map((batch) => (
				<ManagedAssetBatchResolver batchKey={batch.key} key={batch.key} onResolved={onResolved} />
			))}
			{props.children}
		</ManagedAssetUrlsContext.Provider>
	);
}

export function useManagedAssetUrl(asset: ManagedAssetLocator | undefined) {
	const urls = useContext(ManagedAssetUrlsContext);
	return asset === undefined ? undefined : urls.get(managedAssetKey(asset));
}
