import { assert } from "@effect/vitest";
import type { PluginEventGroup } from "@ryot-app/contract/modules/plugins/event-groups";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Layer, Schema } from "effect";

import { PolicyBatchWorkflowLive } from "#modules/automations/lifecycle/policy-batch";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import {
	command,
	relationshipDatabaseLayer,
	userId,
} from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { UserCommandWorkflowDefinitionsLive } from "#modules/user-commands/workflow";
import { workflowEngineTestLayer } from "#testing/effect";

import { EventCreateWorkflowDefinitionsLive } from "./event-create-workflow-live";
import { EventMutations } from "./mutations";

export const eventGroupDeclaration: PluginEventGroup = {
	scope: "session",
	keyProperties: ["position"],
	immutableFields: ["sessionEntityId"],
	immutableProperties: ["kind", "evidence"],
	dependents: [
		{
			minimumCount: 1,
			matchEntity: true,
			preserveMatch: true,
			eventSchemaSlug: "member",
			matchProperties: ["position", "kind"],
		},
	],
};
const propertiesSchema: AppSchema = {
	fields: {
		amount: { type: "number", label: "Amount", description: "Amount" },
		evidence: { type: "string", label: "Evidence", description: "Evidence" },
		kind: { label: "Kind", type: "string", description: "Kind", validation: { required: true } },
		position: {
			type: "integer",
			label: "Position",
			description: "Position",
			validation: { required: true },
		},
	},
};
export const eventGroupWorkflowLayer = Layer.mergeAll(
	UserCommandWorkflowDefinitionsLive,
	EventCreateWorkflowDefinitionsLive,
	PolicyBatchWorkflowLive,
	EntityUserDataService.layer.pipe(
		Layer.provideMerge(Layer.merge(EntityUserDataGraphRepository.layer, MutationReceipts.layer)),
	),
).pipe(
	Layer.provideMerge(
		EventMutations.layer.pipe(
			Layer.provideMerge(EventSchemaReader.layer),
			Layer.provideMerge(relationshipDatabaseLayer()),
		),
	),
	Layer.provideMerge(workflowEngineTestLayer),
);
export const eventGroupFixture = Effect.fnUntraced(function* () {
	const source = revisionPackage(`group-${yield* randomUuid}`, "fixture", "subject");
	const installed = yield* installRevisionPackage(
		{
			...source,
			manifest: {
				...source.manifest,
				entitySchemas: [
					{
						icon: "file",
						slug: "subject",
						name: "Subject",
						propertiesSchema: { fields: {} },
						eventSchemas: [
							{
								slug: "anchor",
								name: "Anchor",
								propertiesSchema,
								eventGroup: eventGroupDeclaration,
							},
							{ slug: "member", name: "Member", propertiesSchema },
						],
					},
					{
						icon: "file",
						slug: "session",
						name: "Session",
						eventSchemas: [],
						propertiesSchema: { fields: {} },
					},
				],
			},
		},
		userId,
	);
	const runtime = yield* PluginRuntimeResolver;
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		owner: definitionOwner(installed.pluginId),
		slug: source.manifest.providers[0]?.slug ?? "",
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
	const accountGeneration = yield* (yield* MutationReceipts.make).currentAccount(userId);
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, {
		userId,
		type: "user",
		accountGeneration,
	});
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
		...pin,
		subject: { userId, type: "user", accountGeneration },
	});
	const entities = yield* EntitiesRepository;
	const [subject] = yield* entities.insertEntities([
		{
			userId,
			scope: "user",
			properties: {},
			name: "Subject",
			populatedAt: null,
			id: EntityId.make(yield* randomUuid),
			entitySchemaPluginId: installed.pluginId,
			entitySchemaSlug: EntitySchemaSlug.make("subject"),
		},
	]);
	assert(subject);
	const relationshipSchemaSlug = source.manifest.relationshipSchemas[0]?.slug;
	assert(relationshipSchemaSlug);
	return {
		userId,
		installed,
		subjectId: subject.id,
		relationshipSchemaSlug,
		command: { ...command(yield* randomUuid), accountGeneration, writeContext: principal },
	};
});
