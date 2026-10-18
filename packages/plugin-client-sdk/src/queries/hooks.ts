import { RegistryContext, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useEffect, useMemo } from "react";

import { ActiveScreenContext } from "../active-screen";
import { useQueryRefresh } from "../refresh/query-refresh";
import {
	type MutationContext,
	MutationDefinition,
	QueryDefinition,
	type RyotMutation,
	type RyotQuery,
} from "./definitions";
import { RyotContext } from "./provider";

export type RyotQueryHookOptions = { readonly refreshOnMutation?: boolean };

export type RyotQueryResult<Data> = {
	readonly isError: boolean;
	readonly isSuccess: boolean;
	readonly isPending: boolean;
	readonly error: null | Error;
	readonly isFetching: boolean;
	readonly refetch: () => void;
	readonly data: Data | undefined;
	readonly status: "error" | "pending" | "success";
};

export type RyotMutationResult<Input, Data, Failure extends Error = Error> = {
	readonly reset: () => void;
	readonly isPending: boolean;
	readonly error: null | Error;
	readonly data: Data | undefined;
	readonly mutate: (input: Input) => void;
	readonly status: "idle" | "error" | "pending" | "success";
	readonly mutateEffect: (input: Input) => Effect.Effect<Data, Failure>;
};

const asError = (cause: Cause.Cause<unknown>) => {
	const error = Cause.squash(cause);
	return error instanceof Error ? error : new Error(String(error));
};

export function useRyotQuery<Data, HostServices, Failure extends Error>(
	query: RyotQuery<void, Data, HostServices, Failure>,
	input?: void,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data>;
export function useRyotQuery<Input, Data, HostServices, Failure extends Error>(
	query: RyotQuery<Input, Data, HostServices, Failure>,
	input: Input,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data>;
export function useRyotQuery<Data, HostServices, Failure extends Error>(
	query: RyotQuery<unknown, Data, HostServices, Failure>,
	input?: unknown,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data> {
	const context = useContext(RyotContext);
	const registry = useContext(RegistryContext);
	if (!context) {
		throw new Error("useRyotQuery must be used within RyotProvider");
	}
	const { client, schedule, hostServices } = context;
	if (!(query instanceof QueryDefinition)) {
		throw new Error("useRyotQuery requires a query created by createRyotQuery");
	}
	const atom = query.atom(registry, client, schedule, hostServices, input);
	useQueryRefresh(
		client,
		schedule,
		atom,
		input,
		query.entityWatch,
		options?.refreshOnMutation !== false,
	);
	const active = useContext(ActiveScreenContext);
	useEffect(() => {
		if (!active || !query.refreshWhile) {
			return undefined;
		}
		let cancel: undefined | (() => void);
		let disposed = false;
		const arm = () => {
			cancel?.();
			cancel = undefined;
			const result = registry.get(atom);
			if (
				disposed ||
				!AsyncResult.isSuccess(result) ||
				!query.refreshWhile?.({ input, data: result.value })
			) {
				return;
			}
			cancel = schedule.after(1000, () => {
				cancel = undefined;
				if (!disposed && !registry.get(atom).waiting) {
					registry.refresh(atom);
				}
				arm();
			});
		};
		const unsubscribe = registry.subscribe(atom, arm);
		arm();
		return () => {
			disposed = true;
			cancel?.();
			unsubscribe();
		};
	}, [active, atom, registry, schedule, query, input]);
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

export const useRyotMutation = <Input, Data, HostServices, Failure extends Error>(
	mutation: RyotMutation<Input, Data, HostServices, Failure>,
): RyotMutationResult<Input, Data, Failure> => {
	const context = useContext(RyotContext);
	const registry = useContext(RegistryContext);
	if (!context) {
		throw new Error("useRyotMutation must be used within RyotProvider");
	}
	const { client, schedule, hostServices } = context;
	// The definition declares the host type; React context cannot link that generic to a provider.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const typedHostServices = hostServices as HostServices;
	if (!(mutation instanceof MutationDefinition)) {
		throw new Error("useRyotMutation requires a mutation created by createRyotMutation");
	}
	const run: (context: MutationContext<Input, HostServices>) => Effect.Effect<Data, Failure> =
		mutation.run;
	const atom = useMemo(
		() =>
			Atom.fn<Input>()<Failure, Data>((input) =>
				Effect.suspend(() => run({ input, client, schedule, hostServices: typedHostServices })),
			),
		[client, run, schedule, typedHostServices],
	);
	const result = useAtomValue(atom);
	const set = useAtomSet(atom);
	const mutateEffect = (input: Input) =>
		Effect.sync(() => registry.set(atom, input)).pipe(
			Effect.andThen(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })),
		);
	let status: RyotMutationResult<Input, Data, Failure>["status"] = "idle";
	if (result.waiting) {
		status = "pending";
	} else if (AsyncResult.isFailure(result)) {
		status = "error";
	} else if (AsyncResult.isSuccess(result)) {
		status = "success";
	}
	return {
		status,
		mutate: set,
		mutateEffect,
		isPending: result.waiting,
		reset: () => set(Atom.Reset),
		data: AsyncResult.isSuccess(result) ? result.value : undefined,
		error: AsyncResult.isFailure(result) ? asError(result.cause) : null,
	};
};
