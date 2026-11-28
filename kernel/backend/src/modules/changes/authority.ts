import type { ChangeSet } from "@ryot-app/contract/modules/changes/change-set";
import { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import type { DefinitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	LocalMessage,
	type Message,
	stampNamespace,
	stampTrustedNamespace,
	TrustedLocalMessage,
} from "@ryot-app/i18n/message";
import { Effect, Result, Schema } from "effect";

import {
	isUserBootstrapPrincipal,
	type PluginSchemaScope,
	principalMessageNamespace,
	type ScriptExecutionPrincipal,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";

import {
	type Changes,
	type ChangeSetWriter,
	changesParts,
	nonEmpty,
	scriptChangeSetParts,
} from "./changes";

/** What a change set may write, resolved once from its writer's principal. */
export type ChangeSetAuthority = {
	readonly userId: null | UserId;
	readonly pluginRevision: null | ScriptPluginRevision;
	readonly notifications: ReadonlyArray<ChangeSetNotification>;
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

/** The parts the change set names that only writers of `kinds` may write, in check order. */
const namedParts = (changes: ChangeSet, kinds: ReadonlyArray<ChangeSetWriter>) =>
	scriptChangeSetParts.flatMap(({ part, writer, present }) =>
		writer !== undefined && kinds.includes(writer.kind) && (writer.named ?? present)(changes)
			? [part]
			: [],
	);

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
	const [userPart] = namedParts(changes, ["user", "direct-user"]);
	if (userPart !== undefined && (userId === null || pluginRevision === null)) {
		return forbidden(userPart, `${userPart} requires a pinned plugin user execution`);
	}
	const [directUserPart] = namedParts(changes, ["direct-user"]);
	if (directUserPart !== undefined && subject.type !== "user") {
		return forbidden(directUserPart, `${directUserPart} is available only to user executions`);
	}
	if (nonEmpty(entities?.ensures) && !isUserBootstrapPrincipal(principal)) {
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
	const [systemPart] = namedParts(changes, ["system"]);
	if (systemPart !== undefined && (!system || pluginRevision?.scope !== "system")) {
		return forbidden(systemPart, `${systemPart} requires a pinned system plugin execution`);
	}
	if (nonEmpty(changes.globalEntities) && principal.providerId === null) {
		return forbidden(
			"globalEntities",
			"Global entity upserts require a provider-associated script",
		);
	}
	if (nonEmpty(changes.signals)) {
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
	if (nonEmpty(changes.notifications)) {
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
	return Result.succeed({ userId, notifications, pluginRevision });
};

const schemaKinds = ["entity", "relationship", "event", "signal"] as const;

/** The first schema a change set names that its plugin revision does not declare. */
export const undeclaredSchema = (changes: ChangeSet, scope: PluginSchemaScope) => {
	const declared = {
		entity: (slug: string) => scope.entitySchemaSlugs.includes(slug),
		signal: (slug: string) => scope.signalSchemaSlugs.includes(slug),
		relationship: (slug: string) => scope.relationshipSchemaSlugs.includes(slug),
		event: (slug: string) => scope.eventSchemas.some((event) => event.eventSchemaSlug === slug),
	};
	const named = scriptChangeSetParts.map(({ schemas }) => schemas?.(changes) ?? {});
	for (const kind of schemaKinds) {
		const undeclared = named
			.flatMap((schemas) => schemas[kind] ?? [])
			.find((slug) => !declared[kind](slug));
		if (undeclared !== undefined) {
			return undeclared;
		}
	}
	return undefined;
};

/**
 * Every existing entity and event a change set names, with the part that names it and, for an
 * entity the part writes, the schema it names that entity under.
 */
export const changeSetReferences = (changes: ChangeSet) => {
	const named = scriptChangeSetParts.flatMap(({ part, references }) =>
		references === undefined ? [] : [[part, references(changes)] as const],
	);
	return {
		events: named.flatMap(([part, { events = [] }]) =>
			events.map((eventId) => [part, eventId] as const),
		),
		entities: named.flatMap(([part, { entities = [] }]) =>
			entities.map(([entityId, entitySchemaSlug]) =>
				entitySchemaSlug === undefined
					? ([part, entityId] as const)
					: ([part, entityId, entitySchemaSlug] as const),
			),
		),
	};
};

const kernelOwned = (reference: { readonly owner: DefinitionOwner }) =>
	reference.owner.kind === "kernel";

/**
 * A user's own write through the HTTP API names only plugin-owned schemas; kernel services write the
 * kernel-owned ones.
 */
export const rejectKernelOwnedSchemas = (
	changes: Changes,
): Effect.Effect<void, EntityBadRequest | RelationshipBadRequest> => {
	const named = changesParts.flatMap(({ present, schemas }) =>
		schemas !== undefined && present(changes) ? [schemas(changes)] : [],
	);
	if (named.some(({ entity = [] }) => entity.some(kernelOwned))) {
		return Effect.fail(new EntityBadRequest({ reason: { code: "kernel-owned-schema" } }));
	}
	return named.some(({ relationship = [] }) => relationship.some(kernelOwned))
		? Effect.fail(new RelationshipBadRequest({ reason: { code: "kernel-owned-schema" } }))
		: Effect.void;
};
