import type { UserCommand } from "@ryot-app/contract/modules/mutations/user-command";
import type { PluginEventGroup } from "@ryot-app/contract/modules/plugins/event-groups";
import type { PluginEntityUserStatePolicy } from "@ryot-app/contract/modules/plugins/manifest";
import type {
	AuthoredAppSchema,
	ManifestText,
} from "@ryot-app/contract/modules/plugins/manifest-text";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, EntitySchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Layer, Schema } from "effect";

import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import {
	command,
	relationshipDatabaseLayer,
	userId,
} from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { UserCommands } from "#modules/user-commands/service";
import { workflowEngineTestLayer } from "#testing/effect";

import { type EventCreateInput, makeEventCreate } from "./event-create";
import { EventMutations } from "./mutations";

export const eventGroupDeclaration: PluginEventGroup = {
	keyProperties: ["position"],
	immutableProperties: ["kind", "evidence"],
	dependents: [{ eventSchemaSlug: "member", matchProperties: ["position", "kind"] }],
};
const propertiesSchema: AuthoredAppSchema = {
	fields: {
		amount: { type: "number", description: "Amount", label: { key: "test.amount" } },
		evidence: { type: "string", description: "Evidence", label: { key: "test.evidence" } },
		kind: {
			type: "string",
			description: "Kind",
			label: { key: "test.kind" },
			validation: { required: true },
		},
		position: {
			type: "integer",
			description: "Position",
			validation: { required: true },
			label: { key: "test.position" },
		},
	},
};
export const eventGroupWorkflowLayer = Layer.mergeAll(
	UserCommands.layer,
	EntityUserDataService.layer.pipe(Layer.provideMerge(EntityUserDataGraphRepository.layer)),
).pipe(
	Layer.provideMerge(
		EventMutations.layer.pipe(
			Layer.provideMerge(
				PluginUserSettingsWriter.layer.pipe(Layer.provide(PluginCatalogInvalidatorLive)),
			),
			Layer.provideMerge(EventSchemaReader.layer),
			Layer.provideMerge(relationshipDatabaseLayer()),
		),
	),
	Layer.provideMerge(workflowEngineTestLayer),
);
export const commitUserCommand = (payload: {
	readonly userId: UserId;
	readonly input: UserCommand;
	readonly command: DomainLifecycleCommand;
}) =>
	Effect.flatMap(UserCommands, (commands) =>
		commands.commit(payload.input, payload.command, payload.userId),
	).pipe(
		Effect.map(({ events, entityId }) => {
			assert(entityId);
			return { events, entityId };
		}),
	);

export const createGroupEvents = (input: EventCreateInput) =>
	Effect.flatMap(makeEventCreate, (create) => create(input));

const groupEventSchemas = [
	{
		slug: "anchor",
		propertiesSchema,
		name: { key: "test.anchor" },
		eventGroup: eventGroupDeclaration,
	},
	{ slug: "member", propertiesSchema, name: { key: "test.member" } },
];

type FixtureEventSchema = {
	readonly slug: string;
	readonly name: ManifestText;
	readonly eventGroup?: PluginEventGroup;
	readonly propertiesSchema: AuthoredAppSchema;
};

export const eventGroupFixture = Effect.fnUntraced(function* (
	eventSchemas: ReadonlyArray<FixtureEventSchema> = groupEventSchemas,
	declarations: {
		readonly userState?: PluginEntityUserStatePolicy;
		readonly sessionEventSchemas?: ReadonlyArray<FixtureEventSchema>;
	} = {},
) {
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
						name: { key: "test.subject" },
						eventSchemas: [...eventSchemas],
						propertiesSchema: { fields: {} },
						...(declarations.userState ? { userState: declarations.userState } : {}),
					},
					{
						icon: "file",
						slug: "session",
						name: { key: "test.session" },
						propertiesSchema: { fields: {} },
						eventSchemas: [...(declarations.sessionEventSchemas ?? [])],
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
	const accountUserId = yield* (yield* AccountAdmission.make).currentAccount(userId);
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, {
		userId,
		type: "user",
	});
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
		...pin,
		subject: { userId, type: "user" },
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
		command: { ...command(yield* randomUuid), accountUserId, writeContext: principal },
	};
});
