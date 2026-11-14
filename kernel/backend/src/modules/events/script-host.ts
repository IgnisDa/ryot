import {
	CreateEventItem,
	type CreateEventsResponse,
	UpdateEventItem,
} from "@ryot-app/contract/modules/events/schemas";
import { EventId, UserId } from "@ryot-app/contract/schema/brands";
import {
	deleteEventsArgsSchema,
	EVENT_MUTATION_SANDBOX_LIMITS,
	updateEventsArgsSchema,
} from "@ryot-app/plugin-backend-sdk/core";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { Effect, Schema } from "effect";

import {
	type AdditionalScriptHostImplementationMap,
	requireSandboxCapabilityInput,
	type ScriptRunInput,
	type UserSandboxRunInput,
} from "#modules/scripts/authorization/capabilities";
import {
	reportSandboxLifecycleWarnings,
	sandboxLifecycleCommand,
	userSandboxRunUserId,
} from "#modules/scripts/host/execution-context";
import {
	lifecycleHostFailure,
	type LifecycleHostInput,
	userLifecycleSource,
} from "#modules/scripts/host/lifecycle-host";

import { EventsService } from "./service";

const decodeCreateEventsPayload = Schema.decodeUnknownEffect(Schema.Array(CreateEventItem));

export const toSandboxCreateEventsResult = (result: CreateEventsResponse) =>
	reportSandboxLifecycleWarnings("createEvents", result.warnings).pipe(
		Effect.andThen(() =>
			result.failure
				? Effect.fail({
						message: `Event creation failed: ${result.failure.reason.code}`,
						data: {
							count: result.count,
							outcomes: result.outcomes,
							code: result.failure.reason.code,
							partial: result.failure.reason.code !== "mutation-conflict",
						},
					} satisfies SandboxHostError)
				: Effect.succeed({ count: result.count, outcomes: result.outcomes }),
		),
	);

export const eventLifecycleHostSteps = (events: EventsService["Service"]) => {
	return {
		updateEvents: {
			commit: (input: LifecycleHostInput<"UpdateEvents">) =>
				events.updateBatch(input.items, input.userId, input.command).pipe(
					Effect.flatMap(({ count, warnings }) =>
						reportSandboxLifecycleWarnings("updateEvents", warnings).pipe(Effect.as({ count })),
					),
					Effect.mapError(lifecycleHostFailure),
				),
			validate: (
				rawInput: ScriptRunInput,
				items: ReadonlyArray<unknown>,
			): Effect.Effect<LifecycleHostInput<"UpdateEvents">, SandboxHostError> =>
				sandboxHostEffect(
					Effect.gen(function* () {
						const input = yield* requireSandboxCapabilityInput(rawInput, "updateEvents");
						if (items.length > EVENT_MUTATION_SANDBOX_LIMITS.items) {
							return yield* Effect.fail(
								`updateEvents exceeds ${EVENT_MUTATION_SANDBOX_LIMITS.items} items`,
							);
						}
						const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(UpdateEventItem))(items);
						const command = yield* sandboxLifecycleCommand(
							input,
							userLifecycleSource(input),
							"updateEvents",
						);
						return {
							command,
							items: decoded,
							_tag: "UpdateEvents",
							userId: UserId.make(userSandboxRunUserId(input)),
						} as const;
					}),
				),
		},
		deleteEvents: {
			commit: (input: LifecycleHostInput<"DeleteEvents">) =>
				events.deleteBatch(input.eventIds, input.userId, input.command, input.expected).pipe(
					Effect.flatMap(({ count, warnings }) =>
						reportSandboxLifecycleWarnings("deleteEvents", warnings).pipe(Effect.as({ count })),
					),
					Effect.mapError(lifecycleHostFailure),
				),
			validate: (
				rawInput: ScriptRunInput,
				eventIds: ReadonlyArray<string>,
				options?: Parameters<AdditionalScriptHostImplementationMap["deleteEvents"]>[2],
			): Effect.Effect<LifecycleHostInput<"DeleteEvents">, SandboxHostError> =>
				sandboxHostEffect(
					Effect.gen(function* () {
						const input = yield* requireSandboxCapabilityInput(rawInput, "deleteEvents");
						if (eventIds.length > EVENT_MUTATION_SANDBOX_LIMITS.items) {
							return yield* Effect.fail(
								`deleteEvents exceeds ${EVENT_MUTATION_SANDBOX_LIMITS.items} items`,
							);
						}
						const decoded = yield* Schema.decodeEffect(Schema.Array(EventId))(eventIds);
						const command = yield* sandboxLifecycleCommand(
							input,
							userLifecycleSource(input),
							"deleteEvents",
						);
						return {
							command,
							eventIds: decoded,
							_tag: "DeleteEvents",
							expected: options?.expected,
							userId: UserId.make(userSandboxRunUserId(input)),
						} as const;
					}),
				),
		},
	};
};

export type EventLifecycleHostSteps = ReturnType<typeof eventLifecycleHostSteps>;

export const makeEventScriptHost = Effect.gen(function* () {
	const events = yield* EventsService;
	const lifecycle = eventLifecycleHostSteps(events);

	const createEvents = (input: UserSandboxRunInput, payload: ReadonlyArray<CreateEventItem>) =>
		Effect.gen(function* () {
			if (payload.length === 0) {
				return { count: 0, outcomes: [] };
			}
			const command = yield* sandboxLifecycleCommand(
				input,
				userLifecycleSource(input),
				"createEvents",
			);
			return yield* events
				.create({ payload, command, userId: UserId.make(userSandboxRunUserId(input)) })
				.pipe(Effect.flatMap(toSandboxCreateEventsResult));
		});
	return {
		createEvents: (rawInput, body) =>
			requireSandboxCapabilityInput(rawInput, "createEvents").pipe(
				Effect.flatMap((input) =>
					decodeCreateEventsPayload(body).pipe(
						Effect.flatMap((payload) => createEvents(input, payload)),
					),
				),
				sandboxHostEffect,
			),
		updateEvents: (rawInput, items) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const [decoded] = yield* Schema.decodeEffect(updateEventsArgsSchema)([items]);
					const input = yield* lifecycle.updateEvents.validate(rawInput, decoded);
					return yield* lifecycle.updateEvents.commit(input);
				}),
			),
		deleteEvents: (
			rawInput,
			eventIds,
			options?: Parameters<AdditionalScriptHostImplementationMap["deleteEvents"]>[2],
		) =>
			sandboxHostEffect(
				Effect.gen(function* () {
					const [decoded, decodedOptions] = yield* Schema.decodeEffect(deleteEventsArgsSchema)([
						eventIds,
						options,
					]);
					const input = yield* lifecycle.deleteEvents.validate(rawInput, decoded, decodedOptions);
					return yield* lifecycle.deleteEvents.commit(input);
				}),
			),
	} satisfies Pick<
		AdditionalScriptHostImplementationMap,
		"createEvents" | "deleteEvents" | "updateEvents"
	>;
});
