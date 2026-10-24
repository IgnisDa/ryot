import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { makeRyotRuntime, type RyotRuntime } from "@ryot-app/plugin-client-sdk/runtime";
import { Effect } from "effect";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { KernelRyotClientEntry, KernelRyotClientStore } from "#/api/ryot-client";
import { apiScopeKey } from "#/api/scope";

type Props = KernelRyotClientEntry & {
	readonly children: ReactNode;
	readonly store: KernelRyotClientStore;
};

export function KernelRyotProvider(props: Props) {
	return <CommittedRyotProvider key={apiScopeKey(props.hostServices.scope)} {...props} />;
}

function CommittedRyotProvider(props: Props) {
	const { store, client, hostServices } = props;
	const entry = useMemo(() => ({ client, hostServices }), [client, hostServices]);
	const [runtime, setRuntime] = useState<RyotRuntime>();
	useEffect(() => {
		const release = store.commit(entry);
		const lifetime = entry.hostServices.runtime.runFork(
			Effect.acquireUseRelease(
				Effect.sync(() => makeRyotRuntime(entry.client)),
				(owned) => Effect.sync(() => setRuntime(owned)).pipe(Effect.andThen(Effect.never)),
				(owned) => owned.disposeEffect,
			),
		);
		return () => {
			release();
			lifetime.interruptUnsafe();
		};
	}, [store, entry]);
	if (runtime === undefined) {
		return null;
	}
	return (
		<RyotProvider runtime={runtime} hostServices={entry.hostServices}>
			{props.children}
		</RyotProvider>
	);
}
