import { Effect, ManagedRuntime } from "effect";
import { useEffect, useEffectEvent, useId, useRef } from "react";

import { useEntityInterest } from "./provider";
import { EntityUpdateBatcher } from "./update-batcher";

type UseEntityRefreshProps = {
	readonly blocked: boolean;
	readonly identity: unknown;
	readonly refresh: () => void;
	readonly entityIds: readonly string[];
};

export function useEntityRefresh(props: UseEntityRefreshProps) {
	const owner = `entity-refresh:${useId()}`;
	const refresh = useEffectEvent(props.refresh);
	const runtime = useRef<ManagedRuntime.ManagedRuntime<EntityUpdateBatcher, never> | undefined>(
		undefined,
	);

	useEffect(() => {
		const nextRuntime = ManagedRuntime.make(
			EntityUpdateBatcher.layer({ onBatch: () => Effect.sync(refresh) }),
		);
		runtime.current = nextRuntime;
		return () => {
			if (runtime.current === nextRuntime) {
				runtime.current = undefined;
			}
			void nextRuntime.dispose();
		};
	}, [owner, props.identity]);

	useEntityInterest(owner, props.entityIds, "visible", (frame) => {
		runtime.current?.runFork(Effect.flatMap(EntityUpdateBatcher, (batcher) => batcher.push(frame)));
	});

	useEffect(() => {
		runtime.current?.runFork(
			Effect.flatMap(EntityUpdateBatcher, (batcher) => batcher.setBlocked(props.blocked)),
		);
	}, [props.blocked]);
}
