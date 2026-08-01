import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";
import { Cause, Duration, Effect, ManagedRuntime, Schedule, Stream } from "effect";
import { HttpClientResponse } from "effect/unstable/http";
import { randomUUID } from "expo-crypto";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
} from "react";

import { authenticatedExpoContractClient } from "@/api/transport";

import { EntityInterestCoordinator } from "./coordinator";
import { InterestSseParser } from "./sse";

type CoordinatorEffect = Effect.Effect<void, never, EntityInterestCoordinator>;

type InterestBridge = {
	attach: (runtime: ManagedRuntime.ManagedRuntime<EntityInterestCoordinator, never>) => void;
	detach: (runtime: ManagedRuntime.ManagedRuntime<EntityInterestCoordinator, never>) => void;
	run: (effect: CoordinatorEffect) => void;
};

const InterestContext = createContext<InterestBridge | undefined>(undefined);

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
	const bridge = useMemo<InterestBridge>(() => {
		let current: ManagedRuntime.ManagedRuntime<EntityInterestCoordinator, never> | undefined;
		return {
			attach: (runtime) => {
				current = runtime;
			},
			detach: (runtime) => {
				if (current === runtime) {
					current = undefined;
				}
			},
			run: (effect) => {
				current?.runFork(effect);
			},
		};
	}, []);

	useLayoutEffect(() => {
		const runtime = ManagedRuntime.make(
			EntityInterestCoordinator.layer({
				declareInterest: (streamId, entityIds) =>
					authenticatedExpoContractClient(props.serverUrl).pipe(
						Effect.flatMap((client) =>
							client["entity-interest"].declareInterest({
								payload: { streamId, entityIds: [...entityIds] },
							}),
						),
						Effect.map((response) => response.terminal),
					),
				onDeclarationFailure: (error, attempt, retryDelayMs) =>
					Effect.logWarning("entity interest declaration failed; retrying", {
						error,
						attempt,
						userId: props.userId,
						retryDelayMs,
					}),
			}),
		);
		bridge.attach(runtime);
		const connect = Effect.gen(function* () {
			const coordinator = yield* EntityInterestCoordinator;
			const streamId = randomUUID();
			const parser = new InterestSseParser();
			yield* Effect.gen(function* () {
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
						Effect.gen(function* () {
							for (const event of parser.push(chunk)) {
								if (event.type === "connected" && event.frame.streamId === streamId) {
									yield* coordinator.setConnection(streamId);
								} else if (event.type === "entity:updated") {
									yield* coordinator.receive(event.frame);
								}
							}
						}),
					),
				);
			}).pipe(Effect.ensuring(coordinator.disconnect(streamId)));
		}).pipe(
			Effect.tapCause((cause) =>
				Cause.hasInterruptsOnly(cause)
					? Effect.void
					: Effect.logWarning("entity interest stream failed", Cause.pretty(cause)),
			),
			Effect.retry(retrySchedule),
			Effect.repeat(Schedule.spaced("1 second")),
		);
		runtime.runFork(connect);
		return () => {
			bridge.detach(runtime);
			void runtime.dispose();
		};
	}, [bridge, props.serverUrl, props.userId]);

	return <InterestContext.Provider value={bridge}>{props.children}</InterestContext.Provider>;
}

export function useEntityInterest(
	owner: string,
	entityIds: readonly string[],
	onUpdate: (frame: EntityUpdatedFrame) => void,
) {
	const bridge = useContext(InterestContext);
	const handleUpdate = useEffectEvent((frame: EntityUpdatedFrame) => onUpdate(frame));

	if (!bridge) {
		throw new Error("useEntityInterest must be used within EntityInterestProvider");
	}

	useEffect(
		() => () => {
			bridge.run(
				Effect.flatMap(EntityInterestCoordinator, (coordinator) =>
					coordinator.removeInterest(owner),
				),
			);
		},
		[bridge, owner],
	);
	useEffect(() => {
		bridge.run(
			Effect.flatMap(EntityInterestCoordinator, (coordinator) =>
				coordinator.setInterest(owner, entityIds, handleUpdate),
			),
		);
	}, [bridge, entityIds, owner]);
}
