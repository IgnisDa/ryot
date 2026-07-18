import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";
import { useEffect, useEffectEvent, useRef } from "react";

import { useEntityInterest } from "./provider";
import { EntityUpdateBatcher, type EntityUpdateBatchHandler } from "./update-batcher";

type UseEntityUpdatesProps = {
	readonly owner: string;
	readonly blocked: boolean;
	readonly windowMs?: number;
	readonly onDrain?: () => void;
	readonly maxBatchSize?: number;
	readonly entityIds: readonly string[];
	readonly onBatch: EntityUpdateBatchHandler<EntityUpdatedFrame>;
};

export function useEntityUpdates(props: UseEntityUpdatesProps) {
	const onBatch = useEffectEvent(props.onBatch);
	const onDrain = useEffectEvent(props.onDrain ?? (() => undefined));
	const batcher = useRef<EntityUpdateBatcher | null>(null);

	useEffect(() => {
		const nextBatcher = new EntityUpdateBatcher({
			windowMs: props.windowMs,
			onDrain: () => onDrain(),
			maxBatchSize: props.maxBatchSize,
			onBatch: (updates, signal) => onBatch(updates, signal),
		});
		batcher.current = nextBatcher;
		return () => {
			nextBatcher.dispose();
			if (batcher.current === nextBatcher) {
				batcher.current = null;
			}
		};
	}, [props.maxBatchSize, props.windowMs]);

	useEntityInterest(props.owner, props.entityIds, (frame) => batcher.current?.push(frame));

	useEffect(() => {
		batcher.current?.setBlocked(props.blocked);
	}, [props.blocked, props.maxBatchSize, props.windowMs]);
}
