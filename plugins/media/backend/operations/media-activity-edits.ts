import { EVENT_MUTATION_SANDBOX_LIMITS, type ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	eventSchemaPredicate,
	executeRyotqlRecipe,
	inArray,
	join,
	literal,
	or,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import {
	mediaActivityDeclaredProperties,
	mediaActivityEntitySchemaSlugs,
	mediaActivityEventSchemaSlugs,
} from "../../shared/media-activity-fields";
import type { MediaEventSnapshot } from "../../shared/media-activity-operations";
import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";

type EditableCombination = readonly [entitySchemaSlug: string, eventSchemaSlug: string];

export const MEDIA_EDIT_CHUNK_SIZE = EVENT_MUTATION_SANDBOX_LIMITS.items;

export const STALE_RECORD_MESSAGE = "This record changed elsewhere. Reload and try again.";

export const UNEDITABLE_RECORD_MESSAGE = "This record can't be edited.";

export const activityCombinations: readonly EditableCombination[] =
	mediaActivityEntitySchemaSlugs.flatMap((entity) =>
		mediaActivityEventSchemaSlugs.flatMap((event) =>
			mediaActivityDeclaredProperties(entity, event) === undefined
				? []
				: [[entity, event] as const],
		),
	);

export const reviewCombinations: readonly EditableCombination[] =
	mediaLibraryMemberEntitySchemaSlugs.map((entity) => [entity, "review"] as const);

const editTargetsRecipe = defineRecipe(
	(input: {
		readonly ids: readonly string[];
		readonly combinations: readonly EditableCombination[];
	}) => {
		const visible = table("event", "editVisibleEvent");
		const event = table("event", "editTargetEvent");
		const entity = table("entity", "editTargetEntity");
		const byId = (from: typeof event) =>
			inArray(
				column(from, "id"),
				input.ids.map((id) => literal(id)),
			);
		return {
			map: ({ allowed, visible: seen }) =>
				Result.succeed({ allowed: allowed.items, visibleIds: seen.items.map(({ id }) => id) }),
			queries: {
				visible: selectedRows(visible, {
					where: byId(visible),
					limit: MEDIA_EDIT_CHUNK_SIZE,
					orderBy: [ascending(column(visible, "id"))],
					selection: { id: selectedField(column(visible, "id"), Schema.String) },
				}),
				allowed: selectedRows(event, {
					limit: MEDIA_EDIT_CHUNK_SIZE,
					orderBy: [ascending(column(event, "id"))],
					joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
					where: and(
						byId(event),
						or(
							...input.combinations.map(([entitySlug, eventSlug]) =>
								eventSchemaPredicate(event, entity, entitySlug, eventSlug, { kind: "self" }),
							),
						),
					),
					selection: {
						id: selectedField(column(event, "id"), Schema.String),
						eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						properties: selectedField(
							column(event, "properties"),
							Schema.Record(Schema.String, Schema.Json),
						),
					},
				}),
			},
		};
	},
);

export type EditTarget = {
	readonly id: string;
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly properties: { readonly [key: string]: Schema.Json };
};

const reject = (message: string) => Effect.fail(new OperationRejectedError(message));

/**
 * Visible records of the allowed media schemas among `ids`. A visible record of any other schema
 * rejects the request; ids that resolve to nothing pass through for the host to treat as missing.
 */
export const loadEditTargets = (
	host: Pick<ScriptHost, "executeRyotql">,
	ids: readonly string[],
	combinations: readonly EditableCombination[],
	disallowed: string,
) =>
	Effect.gen(function* () {
		const { allowed, visibleIds } = yield* executeRyotqlRecipe(
			host.executeRyotql,
			editTargetsRecipe({ ids, combinations }),
		);
		const allowedIds = new Set(allowed.map(({ id }) => id));
		if (visibleIds.some((id) => !allowedIds.has(id))) {
			return yield* reject(disallowed);
		}
		return allowed satisfies readonly EditTarget[];
	});

export const requireDeclaredProperties = (
	target: EditTarget,
	declared: readonly string[] | undefined,
) =>
	declared !== undefined && Object.keys(target.properties).every((key) => declared.includes(key))
		? Effect.void
		: reject(UNEDITABLE_RECORD_MESSAGE);

const HostFailureCode = Schema.Struct({ code: Schema.String });

const hostFailureCode = (error: SandboxHostError) => {
	const decoded = Schema.decodeUnknownOption(HostFailureCode)(error.data);
	return decoded._tag === "Some" ? decoded.value.code : undefined;
};

const hostRejectionMessage = (error: SandboxHostError, code: string) => {
	if (code === "event-stale") {
		return STALE_RECORD_MESSAGE;
	}
	return code === "event-not-found" ? "This record no longer exists." : error.message;
};

/** Typed host refusals become operation rejections; failures without a code stay failures. */
export const rejectHostFailure = (error: SandboxHostError) => {
	const code = hostFailureCode(error);
	return code === undefined ? Effect.fail(error) : reject(hostRejectionMessage(error, code));
};

/** A failure before anything was written is final for the request as submitted. */
export const rejectAnyHostFailure = (error: SandboxHostError) =>
	reject(hostRejectionMessage(error, hostFailureCode(error) ?? ""));

export const writePrecondition = (expected: MediaEventSnapshot) => ({
	kind: "fields" as const,
	entityId: expected.entityId,
	occurredAt: expected.occurredAt,
	properties: expected.properties,
	sessionEntityId: expected.sessionEntityId,
	absentProperties: expected.absentProperties,
});
