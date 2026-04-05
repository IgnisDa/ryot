import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";
import { Cause, Duration, Effect, Schedule, Stream } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { randomUUID } from "expo-crypto";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useEffectEvent,
	useMemo,
} from "react";

import { authenticatedExpoContractClient } from "@/api/transport";

import { EntityInterestCoordinator } from "./coordinator";
import { InterestSseParser } from "./sse";

const InterestContext = createContext<EntityInterestCoordinator | undefined>(undefined);

const retrySchedule = Schedule.exponential("1 second").pipe(
	Schedule.modifyDelay(({ duration }) =>
		Effect.succeed(Duration.min(duration, Duration.seconds(30))),
	),
);

export function EntityInterestProvider(props: {
	userId: string;
	serverUrl: string;
	children: ReactNode;
}) {
	const coordinator = useMemo(
		() =>
			new EntityInterestCoordinator(
				(streamId, entityIds, signal) =>
					authenticatedExpoContractClient(props.serverUrl).pipe(
						Effect.flatMap((client) =>
							client["entity-interest"].declareInterest({
								payload: { streamId, entityIds: [...entityIds] },
							}),
						),
						Effect.map((response) => response.terminal),
						(effect) => Effect.runPromise(effect, { signal }),
					),
				undefined,
				(error, attempt, retryDelayMs) => {
					Effect.runFork(
						Effect.logWarning("entity interest declaration failed; retrying", {
							error,
							attempt,
							userId: props.userId,
							retryDelayMs,
						}),
					);
				},
			),
		[props.serverUrl, props.userId],
	);

	useEffect(() => {
		const controller = new AbortController();
		const connect = Effect.gen(function* () {
			const streamId = randomUUID();
			const parser = new InterestSseParser();
			const response = yield* authenticatedExpoContractClient(props.serverUrl).pipe(
				Effect.flatMap((client) =>
					client["entity-interest"].stream({
						query: { streamId },
						responseMode: "response-only",
					}),
				),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
			);
			yield* response.stream.pipe(
				Stream.decodeText,
				Stream.runForEach((chunk) =>
					Effect.sync(() => {
						for (const event of parser.push(chunk)) {
							if (event.type === "connected" && event.frame.streamId === streamId) {
								coordinator.setConnection(streamId);
							} else if (event.type === "entity:updated") {
								coordinator.receive(event.frame);
							}
						}
					}),
				),
			);
		}).pipe(
			Effect.ensuring(Effect.sync(() => coordinator.setConnection(undefined))),
			Effect.tapCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.void
					: Effect.logWarning("entity interest stream failed", Cause.pretty(cause)),
			),
			Effect.retry(retrySchedule),
			Effect.repeat(Schedule.spaced("1 second")),
		);
		void Effect.runPromise(connect, { signal: controller.signal }).catch(() => undefined);
		return () => {
			coordinator.dispose();
			controller.abort();
		};
	}, [coordinator, props.serverUrl]);

	return <InterestContext.Provider value={coordinator}>{props.children}</InterestContext.Provider>;
}

export function useEntityInterest(
	owner: string,
	entityIds: readonly string[],
	onUpdate: (frame: EntityUpdatedFrame) => void,
) {
	const coordinator = useContext(InterestContext);
	const handleUpdate = useEffectEvent((frame: EntityUpdatedFrame) => {
		if (entityIds.includes(frame.entityId)) {
			onUpdate(frame);
		}
	});

	if (!coordinator) {
		throw new Error("useEntityInterest must be used within EntityInterestProvider");
	}

	useEffect(
		() => () => {
			coordinator.removeInterest(owner);
		},
		[coordinator, owner],
	);
	useEffect(() => coordinator.setInterest(owner, entityIds), [coordinator, entityIds, owner]);
	useEffect(() => {
		const unsubscribe = coordinator.subscribe(handleUpdate);
		return () => {
			unsubscribe();
		};
	}, [coordinator]);
}
