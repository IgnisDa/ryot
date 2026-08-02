import { Effect, ManagedRuntime } from "effect";
import { useEffect, useEffectEvent, useRef } from "react";

import type { EntityInterestPriority } from "./coordinator";
import { useEntityInterest } from "./provider";
import { EntityUpdateBatcher, type EntityUpdateBatchHandler } from "./update-batcher";

type UseEntityUpdatesProps = {
	readonly owner: string;
	readonly blocked: boolean;
	readonly windowMs?: number;
	readonly onDrain?: () => void;
	readonly maxBatchSize?: number;
	readonly entityIds: readonly string[];
	readonly priority: EntityInterestPriority;
	readonly onBatch: EntityUpdateBatchHandler;
};

export function useEntityUpdates(props: UseEntityUpdatesProps) {
	const onBatch = useEffectEvent(props.onBatch);
	const onDrain = useEffectEvent(props.onDrain ?? (() => undefined));
	const runtime = useRef<ManagedRuntime.ManagedRuntime<EntityUpdateBatcher, never> | undefined>(
		undefined,
	);

	useEffect(() => {
		const nextRuntime = ManagedRuntime.make(
			EntityUpdateBatcher.layer({
				windowMs: props.windowMs,
				onDrain: () => onDrain(),
				maxBatchSize: props.maxBatchSize,
				onBatch: (updates) => onBatch(updates),
			}),
		);
		runtime.current = nextRuntime;
		return () => {
			if (runtime.current === nextRuntime) {
				runtime.current = undefined;
			}
			void nextRuntime.dispose();
		};
	}, [props.maxBatchSize, props.owner, props.windowMs]);

	useEntityInterest(props.owner, props.entityIds, props.priority, (frame) => {
		runtime.current?.runFork(Effect.flatMap(EntityUpdateBatcher, (batcher) => batcher.push(frame)));
	});

	useEffect(() => {
		runtime.current?.runFork(
			Effect.flatMap(EntityUpdateBatcher, (batcher) => batcher.setBlocked(props.blocked)),
		);
	}, [props.blocked, props.maxBatchSize, props.owner, props.windowMs]);
}
