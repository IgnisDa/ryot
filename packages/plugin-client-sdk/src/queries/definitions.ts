import type { EntityWatch } from "@ryot-app/plugin-client-contract";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { RyotClient } from "../client/client";
import type { RyotClientError } from "../client/errors";
import type { RyotSchedule } from "../schedule";

const staleTime = 30 * 1_000;
export const idleTTL = 5 * 60 * 1_000;
const queryTypeId = Symbol("@ryot-app/plugin-client-sdk/react/query");
const mutationTypeId = Symbol("@ryot-app/plugin-client-sdk/react/mutation");

export type QueryContext<Input, HostServices> = {
	readonly input: Input;
	readonly client: RyotClient;
	readonly schedule: RyotSchedule;
	readonly hostServices: HostServices;
};

export type MutationContext<Input, HostServices> = QueryContext<Input, HostServices>;

export interface RyotQuery<
	Input,
	Data,
	HostServices = undefined,
	Failure extends Error = RyotClientError,
> {
	readonly [queryTypeId]: {
		readonly data?: Data;
		readonly input?: Input;
		readonly hostServices?: HostServices;
		readonly failure?: Failure;
	};
}

export interface RyotMutation<
	Input,
	Data,
	HostServices = undefined,
	Failure extends Error = RyotClientError,
> {
	readonly [mutationTypeId]: {
		readonly data?: Data;
		readonly input?: Input;
		readonly hostServices?: HostServices;
		readonly failure?: Failure;
	};
}

export type RyotQueryOptions<Input, Data> = {
	/** Cancels in-flight work when the final consumer for an input unmounts. */
	readonly cancelOnUnmount?: boolean;
	readonly initialData?: (input: Input) => Data;
	readonly refreshWhile?: (context: { readonly input: Input; readonly data: Data }) => boolean;
	readonly entityWatch?: (context: {
		readonly input: Input;
		readonly data: Data | undefined;
	}) => EntityWatch;
};

export const makeQueryAtom = <Data, Failure extends Error>(
	run: Effect.Effect<Data, Failure>,
	initialData?: Data,
	cancelOnUnmount = false,
	interested = false,
) => {
	const hydrated = new WeakSet<AtomRegistry.AtomRegistry>();
	const effect = Effect.flatMap(AtomRegistry.AtomRegistry, (registry) => {
		if (initialData !== undefined && !hydrated.has(registry)) {
			hydrated.add(registry);
			return Effect.succeed(initialData);
		}
		return run;
	});
	const source =
		initialData === undefined ? Atom.make(run) : Atom.make(effect, { initialValue: initialData });
	const requestSource = cancelOnUnmount ? source.pipe(Atom.setIdleTTL(0)) : source;
	if (interested) {
		return requestSource.pipe(Atom.setIdleTTL(cancelOnUnmount ? 0 : idleTTL));
	}
	if (initialData !== undefined || cancelOnUnmount) {
		return requestSource;
	}
	return requestSource.pipe(Atom.swr({ staleTime }), Atom.setIdleTTL(idleTTL));
};

export class QueryDefinition<Input, Data, HostServices, Failure extends Error> implements RyotQuery<
	Input,
	Data,
	HostServices,
	Failure
> {
	readonly [queryTypeId] = {};

	constructor(
		readonly atom: (
			registry: AtomRegistry.AtomRegistry,
			client: RyotClient,
			schedule: RyotSchedule,
			hostServices: HostServices,
			input: Input,
			cancelOnUnmount?: boolean,
		) => ReturnType<typeof makeQueryAtom<Data, Failure>>,
		readonly entityWatch?: RyotQueryOptions<Input, Data>["entityWatch"],
		readonly refreshWhile?: RyotQueryOptions<Input, Data>["refreshWhile"],
	) {}
}

export class MutationDefinition<
	Input,
	Data,
	HostServices,
	Failure extends Error,
> implements RyotMutation<Input, Data, HostServices, Failure> {
	readonly [mutationTypeId] = {};

	constructor(
		readonly run: (context: MutationContext<Input, HostServices>) => Effect.Effect<Data, Failure>,
	) {}
}

export function createRyotQuery<Data, Failure extends Error = RyotClientError>(
	query: (context: Omit<QueryContext<void, undefined>, "input">) => Effect.Effect<Data, Failure>,
	options?: RyotQueryOptions<void, Data>,
): RyotQuery<void, Data, undefined, Failure>;
export function createRyotQuery<
	Input,
	Data,
	HostServices = undefined,
	Failure extends Error = RyotClientError,
>(
	query: (context: QueryContext<Input, HostServices>) => Effect.Effect<Data, Failure>,
	options?: RyotQueryOptions<Input, Data>,
): RyotQuery<Input, Data, HostServices, Failure>;
export function createRyotQuery<
	Input,
	Data,
	HostServices = undefined,
	Failure extends Error = RyotClientError,
>(
	query: (context: QueryContext<Input, HostServices>) => Effect.Effect<Data, Failure>,
	options?: RyotQueryOptions<Input, Data>,
) {
	type QuerySelection = { readonly input: Input; readonly cancelOnUnmount: boolean };
	type ClientQueries = {
		schedule: RyotSchedule;
		hostServices: HostServices;
		readonly inputs: (selection: QuerySelection) => ReturnType<typeof makeQueryAtom<Data, Failure>>;
	};
	const registries = new WeakMap<AtomRegistry.AtomRegistry, WeakMap<RyotClient, ClientQueries>>();
	return new QueryDefinition<Input, Data, HostServices, Failure>(
		(
			registry,
			client,
			schedule,
			hostServices,
			input,
			cancelOnUnmount = options?.cancelOnUnmount ?? false,
		) => {
			let clients = registries.get(registry);
			if (!clients) {
				clients = new WeakMap();
				registries.set(registry, clients);
			}
			let clientQueries = clients.get(client);
			if (!clientQueries) {
				const current: ClientQueries = {
					schedule,
					hostServices,
					inputs: Atom.family((selection: QuerySelection) =>
						makeQueryAtom<Data, Failure>(
							Effect.suspend(() =>
								query({
									client,
									input: selection.input,
									schedule: current.schedule,
									hostServices: current.hostServices,
								}),
							),
							options?.initialData?.(selection.input),
							selection.cancelOnUnmount,
							options?.entityWatch !== undefined,
						),
					),
				};
				clientQueries = current;
				clients.set(client, clientQueries);
			}
			clientQueries.hostServices = hostServices;
			clientQueries.schedule = schedule;
			return clientQueries.inputs({ input, cancelOnUnmount });
		},
		options?.entityWatch,
		options?.refreshWhile,
	);
}

export function createRyotMutation<Data, Failure extends Error = RyotClientError>(
	mutation: (
		context: Omit<MutationContext<void, undefined>, "input">,
	) => Effect.Effect<Data, Failure>,
): RyotMutation<void, Data, undefined, Failure>;
export function createRyotMutation<
	Input,
	Data,
	HostServices = undefined,
	Failure extends Error = RyotClientError,
>(
	mutation: (context: MutationContext<Input, HostServices>) => Effect.Effect<Data, Failure>,
): RyotMutation<Input, Data, HostServices, Failure>;
export function createRyotMutation<
	Input,
	Data,
	HostServices = undefined,
	Failure extends Error = RyotClientError,
>(mutation: (context: MutationContext<Input, HostServices>) => Effect.Effect<Data, Failure>) {
	return new MutationDefinition<Input, Data, HostServices, Failure>(mutation);
}
