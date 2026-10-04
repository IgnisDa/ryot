import type { EntityWatch } from "@ryot-app/plugin-client-contract";
import { SETTLE_RING_DURATION_MS } from "@ryot-app/plugin-ui-sdk/sync";
import * as Effect from "effect/Effect";
import { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { ActiveScreenContext } from "../active-screen";
import type { EntityUpdate, EntityWatchSubscription } from "../client/adapter";
import type { RyotClient } from "../client/client";
import { useRyot, useRyotSchedule } from "../queries/provider";
import { createEntityRefresh, entityTransport } from "./entity-refresh";
import { createSettleTracker } from "./settle";

const useSettleTracker = () => {
	const schedule = useRyotSchedule();
	const tracker = useMemo(() => createSettleTracker(schedule, SETTLE_RING_DURATION_MS), [schedule]);
	useEffect(() => () => tracker.dispose(), [tracker]);
	const settled = useSyncExternalStore(tracker.subscribe, tracker.snapshot, tracker.snapshot);
	return { settled, tracker };
};

export const useEntitySettle = (interest: EntityWatch) => {
	const client = useRyot();
	const active = useContext(ActiveScreenContext);
	const { settled, tracker } = useSettleTracker();
	const latestInterest = useRef(interest);
	const subscription = useRef<EntityWatchSubscription | undefined>(undefined);
	useEffect(() => {
		latestInterest.current = interest;
	});
	useEffect(() => {
		if (!active) {
			return undefined;
		}
		const watch = entityTransport(() =>
			client.entities.watch(latestInterest.current, tracker.stage),
		);
		subscription.current = watch;
		return () => {
			subscription.current = undefined;
			entityTransport(() => watch?.dispose());
		};
	}, [client, active, tracker]);
	useEffect(() => {
		entityTransport(() => subscription.current?.update(interest));
	}, [interest]);
	return { settled, commit: tracker.commit };
};

export const useEntityRefresh = (options: {
	readonly blocked: boolean;
	readonly identity: string;
	readonly interest: EntityWatch;
	readonly onRefresh: (updates: readonly EntityUpdate[]) => Effect.Effect<void>;
}) => {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const active = useContext(ActiveScreenContext);
	const { settled, tracker } = useSettleTracker();
	const latest = useRef(options);
	const previous = useRef({ active, identity: options.identity });
	const controller = useRef<
		| {
				subscription: EntityWatchSubscription | undefined;
				readonly client: RyotClient;
				readonly identity: string;
				readonly refresh: ReturnType<typeof createEntityRefresh>;
		  }
		| undefined
	>(undefined);
	useEffect(() => {
		latest.current = options;
	});
	useEffect(() => {
		const refresh = createEntityRefresh(schedule, (updates) => {
			for (const update of updates) {
				tracker.stage(update);
			}
			return Effect.tap(latest.current.onRefresh(updates), () =>
				Effect.sync(() => tracker.commit()),
			);
		});
		controller.current = { client, refresh, subscription: undefined, identity: options.identity };
		return () => {
			controller.current = undefined;
			refresh.dispose();
		};
	}, [client, schedule, options.identity, tracker]);
	useEffect(() => {
		const catchUp =
			previous.current.identity === options.identity && !previous.current.active && active;
		previous.current = { active, identity: options.identity };
		const current = controller.current;
		current?.refresh.block(!active || latest.current.blocked);
		if (!active || current?.client !== client || current.identity !== options.identity) {
			return undefined;
		}
		const subscription = entityTransport(() =>
			client.entities.watch(latest.current.interest, current.refresh.hint),
		);
		current.subscription = subscription;
		if (catchUp) {
			current.refresh.hint();
		}
		return () => {
			current.subscription = undefined;
			entityTransport(() => subscription?.dispose());
		};
	}, [client, options.identity, active]);
	useEffect(() => {
		controller.current?.refresh.block(!active || options.blocked);
		entityTransport(() => controller.current?.subscription?.update(options.interest));
	}, [active, options.interest, options.blocked]);
	return { settled };
};
