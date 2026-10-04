import { UpdateEventItem } from "@ryot-app/contract/modules/events/schemas";
import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";
import { EventId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import {
	changeUserRelationshipBatchSchema,
	upsertGlobalEntitiesOptionsSchema,
	upsertGlobalEntityItemSchema,
	upsertGlobalRelationshipGroupSchema,
} from "@ryot-app/sandbox-sdk/core";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { toSandboxHostError, type UserSandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import { Effect, Schema } from "effect";

import type { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	runLifecycleWriteInline,
	type LifecyclePreparedStep,
} from "#modules/automations/lifecycle/write-step";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import type { PendingRelationshipMutations } from "#modules/relationships/mutation-pipeline";

import { reportSandboxLifecycleWarnings } from "./execution-context";

export const SandboxLifecycleHostInput = Schema.Union([
	Schema.TaggedStruct("Failure", {
		message: Schema.String,
		data: Schema.optional(jsonValueSchema),
	}),
	Schema.TaggedStruct("UpsertGlobalEntities", {
		providerId: SandboxProviderId,
		command: DomainLifecycleCommand,
		items: Schema.Array(upsertGlobalEntityItemSchema),
		options: Schema.NullOr(upsertGlobalEntitiesOptionsSchema),
	}),
	Schema.TaggedStruct("ChangeUserRelationships", {
		userId: UserId,
		command: DomainLifecycleCommand,
		batches: Schema.Array(changeUserRelationshipBatchSchema),
	}),
	Schema.TaggedStruct("UpsertGlobalRelationships", {
		command: DomainLifecycleCommand,
		groups: Schema.Array(upsertGlobalRelationshipGroupSchema),
	}),
	Schema.TaggedStruct("UpdateEvents", {
		userId: UserId,
		command: DomainLifecycleCommand,
		items: Schema.Array(UpdateEventItem),
	}),
	Schema.TaggedStruct("DeleteEvents", {
		userId: UserId,
		command: DomainLifecycleCommand,
		eventIds: Schema.Array(EventId),
	}),
]);
export type SandboxLifecycleHostInput = typeof SandboxLifecycleHostInput.Type;
export type LifecycleHostInput<Tag extends SandboxLifecycleHostInput["_tag"]> = Extract<
	SandboxLifecycleHostInput,
	{ readonly _tag: Tag }
>;

export class SandboxLifecycleHostFailure extends Schema.TaggedError<SandboxLifecycleHostFailure>()(
	"SandboxLifecycleHostFailure",
	{ message: Schema.String, data: Schema.optional(jsonValueSchema) },
) {}

export const lifecycleHostFailure = (error: unknown) => {
	const hostError = toSandboxHostError(error);
	return new SandboxLifecycleHostFailure({
		message: hostError.message,
		...(hostError.data === undefined ? {} : { data: hostError.data }),
	});
};

export const userLifecycleSource = (input: UserSandboxRunInput) =>
	input.principal.subject.type === "user" && input.principal.subject.integrationId
		? ("integration" as const)
		: ("api" as const);

export type LifecycleItemWrite<Item, Result> = {
	readonly items: ReadonlyArray<Item>;
	readonly result: Schema.Codec<Result, unknown>;
	readonly applyPolicies: (
		pending: PendingRelationshipMutations,
	) => Effect.Effect<PendingRelationshipMutations, SandboxLifecycleHostFailure>;
	readonly prepare: (
		item: Item,
		index: number,
	) => Effect.Effect<
		LifecyclePreparedStep<Result, PendingRelationshipMutations>,
		SandboxLifecycleHostFailure
	>;
	readonly commit: (
		item: Item,
	) => (
		pending: PendingRelationshipMutations,
	) => Effect.Effect<
		LifecyclePreparedStep<Result, PendingRelationshipMutations>,
		SandboxLifecycleHostFailure
	>;
};

export const writeInlineLifecycleItems = Effect.fnUntraced(function* <Item, Result>(
	lifecycleExecution: LifecycleExecution["Service"],
	options: LifecycleItemWrite<Item, Result> & { readonly capability: SandboxHostCapability },
) {
	const warnings = [];
	const results = [];
	for (const [index, item] of options.items.entries()) {
		const written = yield* runLifecycleWriteInline(lifecycleExecution, {
			commit: options.commit(item),
			applyPolicies: options.applyPolicies,
			prepare: options.prepare(item, index),
		});
		warnings.push(...written.warnings);
		results.push(written.result);
	}
	yield* reportSandboxLifecycleWarnings(options.capability, warnings);
	return results;
});
