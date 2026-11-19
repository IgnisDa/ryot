import { RegistryContext, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useMemo } from "react";

import { useQueryRefresh } from "../refresh/query-refresh";
import {
	isQueryDefinition,
	MutationDefinition,
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

export function useRyotQuery<Data, Failure extends Error>(
	query: RyotQuery<void, Data, Failure>,
	input?: void,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data>;
export function useRyotQuery<Input, Data, Failure extends Error>(
	query: RyotQuery<Input, Data, Failure>,
	input: Input,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data>;
export function useRyotQuery<Data, Failure extends Error>(
	query: RyotQuery<unknown, Data, Failure>,
	input?: unknown,
	options?: RyotQueryHookOptions,
): RyotQueryResult<Data> {
	const context = useContext(RyotContext);
	const registry = useContext(RegistryContext);
	if (!context) {
		throw new Error("useRyotQuery must be used within RyotProvider");
	}
	const { client, schedule, hostServices } = context;
	if (!isQueryDefinition(query)) {
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

export const useRyotMutation = <Input, Data, Failure extends Error>(
	mutation: RyotMutation<Input, Data, Failure>,
): RyotMutationResult<Input, Data, Failure> => {
	const context = useContext(RyotContext);
	const registry = useContext(RegistryContext);
	if (!context) {
		throw new Error("useRyotMutation must be used within RyotProvider");
	}
	const { client, schedule, hostServices } = context;
	if (!(mutation instanceof MutationDefinition)) {
		throw new Error("useRyotMutation requires a mutation created by createRyotMutation");
	}
	const run: MutationDefinition<Input, Data, Failure>["run"] = mutation.run;
	const atom = useMemo(
		() =>
			Atom.fn<Input>()<Failure, Data>((input) =>
				Effect.suspend(() => run(input, client, schedule, hostServices)),
			),
		[client, run, schedule, hostServices],
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
