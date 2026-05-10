import { useAtomValue } from "@effect/atom-react";
import {
	decodeEntityInterestServerMessage,
	encodeEntityInterestClientMessage,
	type EntityInterestEntityUpdatedMessage,
	type EntityInterestServerMessage,
} from "@ryot/contract/modules/entity-interest/messages";
import { Cause, Duration, Effect, Exit, Fiber, ManagedRuntime, Match, Queue, Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";

import { appClient, appRevalidationSignal } from "@/api/client";
import { makeEntityInterestSocket } from "@/api/entity-interest-socket";
import { useApiScope } from "@/api/scope";
import { userSettingsAtom } from "@/modules/user-settings/atoms";

import { EntityInterestCoordinator, type EntityInterestPriority } from "./coordinator";

type CoordinatorEffect = Effect.Effect<void, never, EntityInterestCoordinator>;

type InterestBridge = {
	run: (effect: CoordinatorEffect) => void;
	attach: (runtime: ManagedRuntime.ManagedRuntime<EntityInterestCoordinator, never>) => void;
	detach: (runtime: ManagedRuntime.ManagedRuntime<EntityInterestCoordinator, never>) => void;
};

const InterestContext = createContext<InterestBridge | undefined>(undefined);
const MAX_RECONNECT_DELAY = Duration.seconds(30);

export function EntityInterestProvider(props: { children: ReactNode }) {
	const scope = useApiScope();
	const settings = useAtomValue(userSettingsAtom(scope));
	const revalidationVersion = useAtomValue(appRevalidationSignal);
	const preferredLanguage = AsyncResult.isSuccess(settings)
		? settings.value.preferences.language
		: undefined;
	const runtimeRef = useRef<
		ManagedRuntime.ManagedRuntime<EntityInterestCoordinator, never> | undefined
	>(undefined);
	const connectionRef = useRef<Fiber.Fiber<never, unknown> | undefined>(undefined);
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
		const runtime = ManagedRuntime.make(EntityInterestCoordinator.layer());
		runtimeRef.current = runtime;
		bridge.attach(runtime);
		return () => {
			if (runtimeRef.current === runtime) {
				runtimeRef.current = undefined;
			}
			bridge.detach(runtime);
			void runtime.dispose();
		};
	}, [bridge, scope]);

	useEffect(() => {
		if (preferredLanguage === undefined) {
			return undefined;
		}
		const runtime = runtimeRef.current;
		if (!runtime) {
			return undefined;
		}
		const runConnection = Effect.gen(function* () {
			const coordinator = yield* EntityInterestCoordinator;
			let failures = 0;
			for (;;) {
				const authentication = { value: false };
				const attempt = Effect.scoped(
					Effect.gen(function* () {
						const ticket = yield* appClient(scope).request.pipe(
							Effect.flatMap((client) => client["entity-interest"].createSocketTicket()),
							Effect.map((response) => response.ticket),
						);
						const socket = yield* makeEntityInterestSocket(scope.serverUrl);
						const outbound = yield* Queue.unbounded<string>();
						const writer = yield* socket.writer;
						yield* Queue.take(outbound).pipe(
							Effect.flatMap(writer),
							Effect.forever,
							Effect.forkScoped,
						);
						const send = (message: Parameters<typeof encodeEntityInterestClientMessage>[0]) =>
							Queue.offer(outbound, encodeEntityInterestClientMessage(message)).pipe(Effect.asVoid);
						let ready = false;
						const handleMessage = (message: EntityInterestServerMessage) => {
							if (!ready && message.type !== "ready") {
								return Effect.fail(new Error("Entity interest message received before ready"));
							}
							return Match.value(message).pipe(
								Match.when({ type: "ready" }, () => {
									if (ready) {
										return Effect.fail(new Error("Duplicate entity interest ready message"));
									}
									ready = true;
									authentication.value = true;
									failures = 0;
									return coordinator.connect(send);
								}),
								Match.when({ type: "applied" }, ({ revision }) =>
									coordinator.acknowledge(send, revision),
								),
								Match.when({ type: "entity-updated" }, (frame) => coordinator.receive(frame)),
								Match.when({ type: "ping" }, ({ nonce }) => send({ type: "pong", nonce })),
								Match.when({ type: "rejected" }, () =>
									Effect.fail(new Error("Entity interest command was rejected")),
								),
								Match.exhaustive,
							);
						};
						yield* socket
							.runString(
								(frame) => {
									const decoded = decodeEntityInterestServerMessage(frame);
									return Result.isFailure(decoded)
										? Effect.fail(new Error("Malformed entity interest server message"))
										: handleMessage(decoded.success);
								},
								{ onOpen: send({ type: "authenticate", ticket }) },
							)
							.pipe(Effect.ensuring(coordinator.disconnect(send)));
					}),
				);
				const result = yield* Effect.exit(attempt);
				if (Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)) {
					return yield* Effect.failCause(result.cause);
				}
				failures = authentication.value ? 1 : failures + 1;
				const retryDelay = Duration.min(Duration.seconds(2 ** (failures - 1)), MAX_RECONNECT_DELAY);
				if (Exit.isFailure(result)) {
					yield* Effect.logWarning("entity interest socket failed; retrying", {
						userId: scope.userId,
						retryDelayMs: Duration.toMillis(retryDelay),
					});
				}
				yield* Effect.sleep(retryDelay);
			}
		});
		const previous = connectionRef.current;
		const connection = runtime.runFork(
			previous ? Fiber.interrupt(previous).pipe(Effect.andThen(runConnection)) : runConnection,
		);
		connectionRef.current = connection;
		return () => {
			void Effect.runPromise(Fiber.interrupt(connection));
		};
	}, [preferredLanguage, revalidationVersion, scope]);

	return <InterestContext.Provider value={bridge}>{props.children}</InterestContext.Provider>;
}

export function useEntityInterest(
	owner: string,
	entityIds: readonly string[],
	priority: EntityInterestPriority,
	onUpdate: (message: EntityInterestEntityUpdatedMessage) => void,
) {
	const bridge = useContext(InterestContext);
	const handleUpdate = useEffectEvent((message: EntityInterestEntityUpdatedMessage) =>
		onUpdate(message),
	);

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
				coordinator.setInterest(owner, entityIds, priority, handleUpdate),
			),
		);
	}, [bridge, entityIds, owner, priority]);
}
