import type { ContractPayload } from "@ryot-app/contract/client";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { manifestText } from "~/fixtures/kernel/manifest-text";

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
		propertiesSchema: { fields: {} },
		name: manifestText("Group subject"),
		eventSchemas: [
			{
				slug: "anchor",
				name: manifestText("Group anchor"),
				eventGroup: {
					keyProperties: ["position"],
					immutableProperties: ["kind", "evidence"],
					dependents: [{ eventSchemaSlug: "member", matchProperties: ["position", "kind"] }],
				},
				propertiesSchema: {
					unknownKeys: "strict",
					fields: {
						kind: { type: "string", label: manifestText("Kind"), description: "Recorded kind" },
						position: {
							type: "integer",
							description: "Group position",
							label: manifestText("Position"),
						},
						evidence: {
							type: "string",
							label: manifestText("Evidence"),
							description: "Recorded evidence",
						},
					},
				},
			},
			{
				slug: "member",
				name: manifestText("Group member"),
				propertiesSchema: {
					unknownKeys: "strict",
					fields: {
						kind: { type: "string", label: manifestText("Kind"), description: "Recorded kind" },
						position: {
							type: "integer",
							description: "Group position",
							label: manifestText("Position"),
						},
					},
				},
			},
		],
	},
	{
		icon: "box",
		slug: "session",
		eventSchemas: [],
		propertiesSchema: { fields: {} },
		name: manifestText("Group session"),
	},
];

export const createEventGroupFixture = (client: Client) =>
	Effect.gen(function* () {
		const { pluginId } = yield* installTestDefinitions({
			client,
			entitySchemas,
			pluginSlug: `event-groups-${yield* randomUuid}`,
		});
		const owner = definitionOwner(pluginId);
		const subject = yield* createEntity(client, {
			properties: {},
			name: `Subject ${yield* randomUuid}`,
			entitySchema: { owner, slug: EntitySchemaSlug.make("subject") },
		});
		const session = yield* createEntity(client, {
			properties: {},
			name: `Session ${yield* randomUuid}`,
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
