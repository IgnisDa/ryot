import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { makeRyotRuntime, type RyotRuntime } from "@ryot-app/plugin-client-sdk/runtime";
import { Effect } from "effect";
import { type ReactNode, useEffect, useState } from "react";

import type { KernelRyotClientEntry } from "#/api/ryot-client";
import { apiScopeKey } from "#/api/scope";

type Props = KernelRyotClientEntry & { readonly children: ReactNode };

export function KernelRyotProvider(props: Props) {
	return <CommittedRyotProvider key={apiScopeKey(props.hostServices.scope)} {...props} />;
}

function CommittedRyotProvider(props: Props) {
	// Equivalent scopes can get a new loader client after a different scope was preloaded.
	const [entry] = useState<KernelRyotClientEntry>(() => ({
		client: props.client,
		hostServices: props.hostServices,
	}));
	const [runtime, setRuntime] = useState<RyotRuntime>();
	useEffect(() => {
		const lifetime = entry.hostServices.runtime.runFork(
			Effect.acquireUseRelease(
				Effect.sync(() => makeRyotRuntime(entry.client)),
				(owned) => Effect.sync(() => setRuntime(owned)).pipe(Effect.andThen(Effect.never)),
				(owned) => owned.disposeEffect,
			),
		);
		return () => lifetime.interruptUnsafe();
	}, [entry]);
	if (runtime === undefined) {
		return null;
	}
	return (
		<RyotProvider runtime={runtime} hostServices={entry.hostServices}>
			{props.children}
		</RyotProvider>
	);
}
