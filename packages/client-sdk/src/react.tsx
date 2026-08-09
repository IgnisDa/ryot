import { RegistryProvider, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { RyotClient } from "./index";

const staleTime = 30 * 1_000;
const idleTTL = 5 * 60 * 1_000;
const queryTypeId = Symbol("@ryot-app/client-sdk/react/query");
const mutationTypeId = Symbol("@ryot-app/client-sdk/react/mutation");
const RyotContext = createContext<RyotClient | undefined>(undefined);

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
};

const makeQueryAtom = <Data,>(
	run: (signal: AbortSignal) => Promise<Data>,
	initialData?: Data,
	cancelOnUnmount = false,
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
	const atom =
		initialData === undefined
			? requestSource.pipe(
					Atom.swr({ staleTime, revalidateOnFocus: true, focusSignal: browserFocusSignal }),
					Atom.setIdleTTL(cancelOnUnmount ? 0 : idleTTL),
				)
			: requestSource;
	return atom;
};

class QueryDefinition<Input, Data> implements RyotQuery<Input, Data> {
	readonly [queryTypeId] = {};

	constructor(
		readonly atom: (client: RyotClient, input: Input) => ReturnType<typeof makeQueryAtom<Data>>,
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
				),
			);
			clients.set(client, inputs);
		}
		return inputs(input);
	});
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

export const RyotProvider = ({ client, children }: { client: RyotClient; children: ReactNode }) => (
	<RegistryProvider defaultIdleTTL={idleTTL}>
		<RyotContext.Provider value={client}>{children}</RyotContext.Provider>
	</RegistryProvider>
);

export const useRyot = () => {
	const client = useContext(RyotContext);
	if (!client) {
		throw new Error("useRyot must be used within RyotProvider");
	}
	return client;
};

export const useRyotTheme = () => {
	const { theme } = useRyot();
	return useSyncExternalStore(theme.subscribe, theme.getSnapshot, theme.getSnapshot);
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
	if (!(query instanceof QueryDefinition)) {
		throw new Error("useRyotQuery requires a query created by createRyotQuery");
	}
	const atom = query.atom(client, input);
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
