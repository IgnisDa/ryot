import type { ContractPayload } from "@ryot-app/contract/client";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { Client } from "./auth";
import { createEntity } from "./entities";
import { installTestDefinitions } from "./test-plugin";

type EntitySchemas = ContractPayload<
	"testSupport",
	"installSystemPlugin"
>["manifest"]["entitySchemas"];

const entitySchemas: EntitySchemas = [
	{
		icon: "box",
		slug: "subject",
		name: "Group subject",
		propertiesSchema: { fields: {} },
		eventSchemas: [
			{
				slug: "anchor",
				name: "Group anchor",
				propertiesSchema: {
					unknownKeys: "strict",
					fields: {
						kind: { label: "Kind", type: "string", description: "Recorded kind" },
						position: { type: "integer", label: "Position", description: "Group position" },
						evidence: { type: "string", label: "Evidence", description: "Recorded evidence" },
					},
				},
				eventGroup: {
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
				},
			},
			{
				slug: "member",
				name: "Group member",
				propertiesSchema: {
					unknownKeys: "strict",
					fields: {
						kind: { label: "Kind", type: "string", description: "Recorded kind" },
						position: { type: "integer", label: "Position", description: "Group position" },
					},
				},
			},
		],
	},
	{
		icon: "box",
		slug: "session",
		eventSchemas: [],
		name: "Group session",
		propertiesSchema: { fields: {} },
	},
];

export const createEventGroupFixture = (client: Client) =>
	Effect.gen(function* () {
		const { pluginId } = yield* installTestDefinitions({
			client,
			entitySchemas,
			pluginSlug: `event-groups-${crypto.randomUUID()}`,
		});
		const owner = definitionOwner(pluginId);
		const subject = yield* createEntity(client, {
			properties: {},
			name: `Subject ${crypto.randomUUID()}`,
			entitySchema: { owner, slug: EntitySchemaSlug.make("subject") },
		});
		const session = yield* createEntity(client, {
			properties: {},
			name: `Session ${crypto.randomUUID()}`,
			entitySchema: { owner, slug: EntitySchemaSlug.make("session") },
		});
		return { subject, session, pluginId };
	});

export const eventGroupPayload = (
	fixture: Effect.Success<ReturnType<typeof createEventGroupFixture>>,
	sessionEntityId = fixture.session.id,
): ContractPayload<"events", "create"> => [
	{
		sessionEntityId,
		entityId: fixture.subject.id,
		occurredAt: "2026-10-01T10:00:00.000Z",
		eventSchemaSlug: EventSchemaSlug.make("anchor"),
		properties: { position: 0, kind: "primary", evidence: "recorded" },
	},
	{
		sessionEntityId,
		entityId: fixture.subject.id,
		occurredAt: "2026-10-01T10:00:00.000Z",
		properties: { position: 0, kind: "primary" },
		eventSchemaSlug: EventSchemaSlug.make("member"),
	},
];
