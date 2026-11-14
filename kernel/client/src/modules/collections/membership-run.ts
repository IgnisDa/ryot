import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

const MEMBERSHIP_CONCURRENCY = 4;

export type MembershipRun = {
	readonly total: number;
	readonly running: boolean;
	readonly succeeded: number;
	readonly failed: readonly EntityId[];
};

export type MembershipChange =
	| { readonly kind: "remove"; readonly collectionId: EntityId }
	| { readonly kind: "add"; readonly properties: unknown; readonly collectionId: EntityId };

const applyChange = (client: RyotClient, change: MembershipChange, entityId: EntityId) =>
	change.kind === "add"
		? client.collections.upsertMembership({
				entityId,
				mode: "add-if-absent",
				properties: change.properties,
				collectionId: change.collectionId,
			})
		: client.collections.removeMembership({ entityId, collectionId: change.collectionId });

const applyMembershipChanges = (
	client: RyotClient,
	change: MembershipChange,
	entityIds: readonly EntityId[],
	onSettled: (entityId: EntityId, succeeded: boolean) => void,
) =>
	Effect.forEach(
		entityIds,
		(entityId) =>
			Effect.isSuccess(applyChange(client, change, entityId)).pipe(
				Effect.flatMap((succeeded) => Effect.sync(() => onSettled(entityId, succeeded))),
			),
		{ discard: true, concurrency: MEMBERSHIP_CONCURRENCY },
	);

export function useMembershipRun() {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const changed = useRef(false);
	const lastChange = useRef<null | MembershipChange>(null);
	const interrupt = useRef<null | (() => void)>(null);
	const [run, setRun] = useState<null | MembershipRun>(null);
	useEffect(() => () => interrupt.current?.(), []);
	const start = (change: MembershipChange, entityIds: readonly EntityId[]) => {
		lastChange.current = change;
		setRun({ failed: [], succeeded: 0, running: true, total: entityIds.length });
		interrupt.current = schedule.run(
			applyMembershipChanges(client, change, entityIds, (entityId, succeeded) => {
				changed.current ||= succeeded;
				setRun(
					(current) =>
						current && {
							...current,
							succeeded: current.succeeded + (succeeded ? 1 : 0),
							failed: succeeded ? current.failed : [...current.failed, entityId],
						},
				);
			}),
			() => {
				interrupt.current = null;
				setRun((current) => current && { ...current, running: false });
			},
		);
	};
	return {
		run,
		start,
		changed: () => changed.current,
		stop: () => interrupt.current?.(),
		retryFailed: () => {
			if (run !== null && lastChange.current !== null) {
				start(lastChange.current, run.failed);
			}
		},
	};
}
