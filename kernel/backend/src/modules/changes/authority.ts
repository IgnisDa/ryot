import type {
	ChangeSet,
	ChangeSetEntityReference,
} from "@ryot-app/contract/modules/changes/change-set";
import type { EntityId, EventId, UserId } from "@ryot-app/contract/schema/brands";
import {
	LocalMessage,
	type Message,
	stampNamespace,
	stampTrustedNamespace,
	TrustedLocalMessage,
} from "@ryot-app/i18n/message";
import { Result, Schema } from "effect";

import {
	isUserBootstrapPrincipal,
	type PluginSchemaScope,
	principalMessageNamespace,
	type ScriptExecutionPrincipal,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";

/** What a change set may write, resolved once from its writer's principal. */
export type ChangeSetAuthority = {
	readonly userId: null | UserId;
	readonly pluginRevision: null | ScriptPluginRevision;
	readonly notifications: ReadonlyArray<ChangeSetNotification>;
	readonly signalActor: { readonly kind: "system" } | { userId: UserId; readonly kind: "user" };
};

type Subject = ScriptExecutionPrincipal["subject"];

type ChangeSetNotification = {
	readonly message: Message;
	readonly sourceKey: string;
	readonly sourceRunId: string;
	readonly accountUserId: UserId;
};

/** A change set part its writer may not write, or that does not resolve. */
export class ChangeSetRejected extends Schema.TaggedError<
	ChangeSetRejected,
	{ readonly brand: unique symbol }
>()("ChangeSetRejected", { part: Schema.String, message: Schema.String }) {}

const userWriter = (subject: Subject) => {
	if (subject.type === "user") {
		return subject.userId;
	}
	return subject.type === "automation-run" ? subject.executionUserId : null;
};

const isSystemWriter = (subject: Subject) =>
	subject.type === "system" ||
	(subject.type === "automation-run" && subject.executionUserId === null);

const has = (value: undefined | ReadonlyArray<unknown>) => value !== undefined && value.length > 0;

const forbidden = (part: string, message: string) =>
	Result.fail(new ChangeSetRejected({ part, message }));

const decodeLocalMessage = Schema.decodeUnknownResult(LocalMessage);
const decodeTrustedLocalMessage = Schema.decodeUnknownResult(TrustedLocalMessage);

const stampedNotification = (
	principal: ScriptExecutionPrincipal,
	message: unknown,
): Result.Result<Message, ChangeSetRejected> => {
	const namespace = principalMessageNamespace(principal);
	if (namespace === null) {
		return forbidden("notifications", "Notifications require plugin or kernel script authority");
	}
	const invalid = (error: Schema.SchemaError) =>
		new ChangeSetRejected({
			part: "notifications",
			message: `Invalid notification message: ${error.message}`,
		});
	return principal.pluginRevision === null
		? Result.mapBoth(decodeTrustedLocalMessage(message), {
				onFailure: invalid,
				onSuccess: (trusted) => stampTrustedNamespace(namespace, trusted),
			})
		: Result.mapBoth(decodeLocalMessage(message), {
				onFailure: invalid,
				onSuccess: (local) => stampNamespace(namespace, local),
			});
};

/**
 * Resolves what a principal may write. User writes need a pinned plugin and an execution user;
 * the root entity, entity deletes, clears, merges, updates and settings need a direct user execution;
 * ensures need the plugin's user bootstrap; global upserts need a pinned system plugin execution,
 * and entity upserts also its provider; notifications need a user automation run.
 */
export const authorizeChangeSet = (
	changes: ChangeSet,
	principal: ScriptExecutionPrincipal,
): Result.Result<ChangeSetAuthority, ChangeSetRejected> => {
	const { subject, pluginRevision } = principal;
	if (subject.type === "agent" || subject.type === "projection") {
		return forbidden("changes", `${subject.type} executions cannot write changes`);
	}
	if (subject.type === "automation-run" && subject.stage === "before") {
		return forbidden("changes", "Before-stage automation runs cannot write changes");
	}
	const userId = userWriter(subject);
	const system = isSystemWriter(subject);
	const entities = changes.entities;
	const userParts: ReadonlyArray<readonly [string, boolean]> = [
		["events", changes.events !== undefined],
		["relationships", changes.relationships !== undefined],
		["folds", changes.folds?.scope === "user"],
	];
	const directUserParts: ReadonlyArray<readonly [string, boolean]> = [
		["entity", changes.entity !== undefined],
		["settings", changes.settings !== undefined],
		["entities.deletes", has(entities?.deletes)],
		["entities.clears", has(entities?.clears)],
		["entities.merges", has(entities?.merges)],
		["entities.updates", has(entities?.updates)],
		["entities.ensures", has(entities?.ensures)],
	];
	for (const [part, present] of [...userParts, ...directUserParts]) {
		if (present && (userId === null || pluginRevision === null)) {
			return forbidden(part, `${part} requires a pinned plugin user execution`);
		}
	}
	for (const [part, present] of directUserParts) {
		if (present && subject.type !== "user") {
			return forbidden(part, `${part} is available only to user executions`);
		}
	}
	if (has(entities?.ensures) && !isUserBootstrapPrincipal(principal)) {
		return forbidden(
			"entities.ensures",
			"Ensures are available only to pinned user bootstrap scripts",
		);
	}
	if (
		changes.settings !== undefined &&
		(subject.type !== "user" ||
			subject.integrationId !== undefined ||
			subject.importRunId !== undefined ||
			subject.integrationRunId !== undefined ||
			principal.initialization !== undefined ||
			isUserBootstrapPrincipal(principal))
	) {
		return forbidden(
			"settings",
			"Plugin user settings cannot be written by integration, import, or bootstrap executions",
		);
	}
	if (changes.folds?.scope === "all-users") {
		if (pluginRevision === null) {
			return forbidden("folds", "Folds for all users require a pinned plugin");
		}
		if (system && pluginRevision.scope !== "system") {
			return forbidden("folds", "System fold requests require a pinned system plugin script");
		}
	}
	const globalParts: ReadonlyArray<readonly [string, boolean]> = [
		["globalEntities", has(changes.globalEntities)],
		["globalRelationships", has(changes.globalRelationships)],
	];
	for (const [part, present] of globalParts) {
		if (present && (!system || pluginRevision?.scope !== "system")) {
			return forbidden(part, `${part} requires a pinned system plugin execution`);
		}
	}
	if (has(changes.globalEntities) && principal.providerId === null) {
		return forbidden(
			"globalEntities",
			"Global entity upserts require a provider-associated script",
		);
	}
	if (has(changes.signals)) {
		if (subject.type !== "automation-run" && subject.type !== "system") {
			return forbidden(
				"signals",
				"Signals are available only to automation runs and system scripts",
			);
		}
		if (
			system &&
			(pluginRevision?.scope !== "system" || principal.metadata.kind !== "automation")
		) {
			return forbidden("signals", "System signals require a pinned system plugin automation");
		}
	}
	const notifications: ChangeSetNotification[] = [];
	if (has(changes.notifications)) {
		if (
			subject.type !== "automation-run" ||
			subject.accountUserId === null ||
			subject.executionUserId !== subject.accountUserId
		) {
			return forbidden("notifications", "Notifications are available only to user automation runs");
		}
		for (const [index, message] of (changes.notifications ?? []).entries()) {
			const stamped = stampedNotification(principal, message);
			if (Result.isFailure(stamped)) {
				return Result.fail(stamped.failure);
			}
			notifications.push({
				message: stamped.success,
				sourceRunId: subject.runId,
				accountUserId: subject.accountUserId,
				sourceKey: `${subject.runId}-changes-${index}-notification`,
			});
		}
	}
	return Result.succeed({
		userId,
		notifications,
		pluginRevision,
		signalActor: userId === null ? { kind: "system" } : { userId, kind: "user" },
	});
};

/** The first schema a change set names that its plugin revision does not declare. */
export const undeclaredSchema = (changes: ChangeSet, scope: PluginSchemaScope) => {
	const entitySlugs = [
		...(changes.entity ? [changes.entity.entitySchemaSlug] : []),
		...(changes.entities?.deletes ?? []).map((item) => item.entitySchemaSlug),
		...(changes.entities?.clears ?? []).map((item) => item.entitySchemaSlug),
		...(changes.entities?.merges ?? []).map((item) => item.entitySchemaSlug),
		...(changes.entities?.updates ?? []).map((item) => item.entitySchemaSlug),
		...(changes.entities?.ensures ?? []).map((item) => item.entitySchemaSlug),
		...(changes.globalEntities ?? []).map((item) => item.entitySchemaSlug),
	];
	const relationshipSlugs = [
		...(changes.relationships?.upserts ?? []),
		...(changes.relationships?.deletes ?? []),
		...(changes.globalRelationships ?? []),
	].map((item) => item.relationshipSchemaSlug);
	const eventSlugs = (changes.events?.creates ?? []).map((item) => item.eventSchemaSlug);
	const signalSlugs = (changes.signals ?? []).map((item) => item.schemaSlug);
	return (
		entitySlugs.find((slug) => !scope.entitySchemaSlugs.includes(slug)) ??
		relationshipSlugs.find((slug) => !scope.relationshipSchemaSlugs.includes(slug)) ??
		eventSlugs.find(
			(slug) => !scope.eventSchemas.some((event) => event.eventSchemaSlug === slug),
		) ??
		signalSlugs.find((slug) => !scope.signalSchemaSlugs.includes(slug))
	);
};

type NamedReference<Id> = readonly [part: string, id: Id];
type NamedEntityReference = readonly [part: string, id: EntityId, entitySchemaSlug?: string];

const existing = (part: string, references: ReadonlyArray<undefined | ChangeSetEntityReference>) =>
	references.flatMap((reference): ReadonlyArray<NamedReference<EntityId>> =>
		reference?.kind === "existing" ? [[part, reference.entityId]] : [],
	);

/**
 * Every existing entity and event a change set names, with the part that names it and, for an
 * entity the part writes, the schema it names that entity under.
 */
export const changeSetReferences = (changes: ChangeSet) => {
	const { entities } = changes;
	const creates = changes.events?.creates ?? [];
	const eventChanges = changes.events?.changes ?? [];
	const updates = eventChanges.flatMap((change) => (change.kind === "update" ? [change.item] : []));
	const relationships = [
		...(changes.relationships?.upserts ?? []),
		...(changes.relationships?.deletes ?? []),
	];
	const entityReferences: ReadonlyArray<NamedEntityReference> = [
		...(changes.entity?.target.kind === "update"
			? [["entity", changes.entity.target.entityId, changes.entity.entitySchemaSlug] as const]
			: []),
		...(entities?.updates ?? []).map(
			({ target, entitySchemaSlug }) =>
				["entities.updates", target.entityId, entitySchemaSlug] as const,
		),
		...(entities?.deletes ?? []).map(
			({ entityId, entitySchemaSlug }) => ["entities.deletes", entityId, entitySchemaSlug] as const,
		),
		...(entities?.clears ?? []).map(
			({ entityId, entitySchemaSlug }) => ["entities.clears", entityId, entitySchemaSlug] as const,
		),
		...(entities?.merges ?? []).flatMap(({ mergeFrom, mergeInto, entitySchemaSlug }) => [
			["entities.merges", mergeFrom, entitySchemaSlug] as const,
			["entities.merges", mergeInto, entitySchemaSlug] as const,
		]),
		...existing(
			"relationships",
			relationships.flatMap(({ source, target }) => [source, target]),
		),
		...existing(
			"events",
			creates.flatMap(({ entity, session }) => [entity, session]),
		),
		...updates.flatMap(({ patch }) =>
			[patch.entityId, patch.sessionEntityId].flatMap((entityId) =>
				entityId ? [["events", entityId] as const] : [],
			),
		),
		...(changes.events?.baselines ?? []).map(({ entityId }) => ["events", entityId] as const),
	];
	const eventReferences: ReadonlyArray<NamedReference<EventId>> = [
		...eventChanges.map(
			(change) =>
				["events", change.kind === "update" ? change.item.eventId : change.eventId] as const,
		),
		...[...creates, ...updates.map(({ patch }) => patch)].flatMap(({ orderAfter }) =>
			orderAfter ? [["events", orderAfter.eventId] as const] : [],
		),
	];
	return { events: eventReferences, entities: entityReferences };
};
