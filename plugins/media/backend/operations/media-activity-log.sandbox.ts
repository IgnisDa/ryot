import {
	type CreateEventItem,
	EVENT_MUTATION_SANDBOX_LIMITS,
	recoverPartialCreateEvents,
	type ScriptHost,
} from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	executeRyotqlRecipe,
	inArray,
	literal,
	or,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { entityId } from "../../shared/entity-selections";
import { episodicEpisodeMembership } from "../../shared/episodic-recipes";
import {
	type EpisodicKindConfig,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	MediaActivityLogInput,
	MediaActivityLogOutput,
	type MediaActivityWhen,
} from "../../shared/media-activity-operations";
import {
	builtinMediaEntitySchemaSlugs,
	isPositional,
	positionalProperties,
} from "../../shared/media-schema-slugs";

class MediaActivityRejectedError extends Error {
	readonly _tag = "MediaActivityRejectedError";
}

const reject = (message: string) => Effect.fail(new MediaActivityRejectedError(message));

const episodicConfigs: Readonly<Record<string, EpisodicKindConfig>> = {
	show: showEpisodicKindConfig,
	podcast: podcastEpisodicKindConfig,
};

const lifecycleSchemaSlugs = new Set<string>(
	builtinMediaEntitySchemaSlugs.filter((slug) => !(slug in episodicConfigs)),
);

const targetRecipe = defineRecipe((id: string) => {
	const entity = table("entity", "activityTarget");
	return {
		map: ({ target }) => Result.succeed(target),
		queries: {
			target: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: { schemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String) },
				where: and(
					entityId(entity, id),
					or(
						...builtinMediaEntitySchemaSlugs.map((slug) =>
							entitySchemaPredicate(entity, slug, { kind: "self" }),
						),
					),
				),
			}),
		},
	};
});

const episodeMembersRecipe = defineRecipe(
	(input: {
		readonly parentEntityId: string;
		readonly config: EpisodicKindConfig;
		readonly episodeEntityIds: readonly string[];
	}) => {
		const episode = table("entity", "activityEpisode");
		return {
			map: ({ members }) => Result.succeed(members.items.length),
			queries: {
				members: selectedRows(episode, {
					limit: input.episodeEntityIds.length,
					orderBy: [ascending(column(episode, "id"))],
					selection: { id: selectedField(column(episode, "id"), Schema.String) },
					where: and(
						entitySchemaPredicate(episode, input.config.episodeSchemaSlug, { kind: "self" }),
						inArray(
							column(episode, "id"),
							input.episodeEntityIds.map((id) => literal(id)),
						),
						episodicEpisodeMembership(
							input.config,
							episode,
							input.parentEntityId,
							"activityMember",
						),
					),
				}),
			},
		};
	},
);

const completeEvent = (
	id: string,
	when: MediaActivityWhen,
	submittedAt: string,
	extras: { readonly consumedOn?: string | undefined; readonly timeSpent?: number | undefined },
): CreateEventItem => ({
	entityId: id,
	eventSchemaSlug: "complete",
	occurredAt: when.kind === "date" ? when.finishedOn : submittedAt,
	properties: {
		...(extras.consumedOn === undefined ? {} : { consumedOn: extras.consumedOn }),
		...(extras.timeSpent === undefined ? {} : { timeSpent: extras.timeSpent }),
		...(when.kind === "date" && when.startedOn !== undefined ? { startedOn: when.startedOn } : {}),
		...(when.kind === "unknown" ? { dateUnknown: true } : {}),
	},
});

type ActivityHost = Pick<ScriptHost, "executeRyotql" | "createEvents">;

const findTarget = (host: ActivityHost, id: string) =>
	Effect.gen(function* () {
		const target = yield* executeRyotqlRecipe(host.executeRyotql, targetRecipe(id));
		if (target === undefined) {
			return yield* reject("Media entity not found");
		}
		return target;
	});

const buildEvents = (
	{ entry, submittedAt }: MediaActivityLogInput,
	host: ActivityHost,
): Effect.Effect<readonly CreateEventItem[], unknown> =>
	Effect.gen(function* () {
		if (entry.kind === "status") {
			yield* findTarget(host, entry.entityId);
			return [{ properties: {}, entityId: entry.entityId, eventSchemaSlug: entry.status }];
		}
		if (entry.kind === "complete") {
			const { schemaSlug } = yield* findTarget(host, entry.entityId);
			if (!lifecycleSchemaSlugs.has(schemaSlug)) {
				return yield* reject("This media type cannot be completed directly");
			}
			return [completeEvent(entry.entityId, entry.when, submittedAt, entry)];
		}
		if (entry.kind === "progress") {
			const { schemaSlug } = yield* findTarget(host, entry.entityId);
			if (!lifecycleSchemaSlugs.has(schemaSlug)) {
				return yield* reject("This media type has no progress");
			}
			const positionProperty = isPositional(schemaSlug)
				? positionalProperties[schemaSlug].position
				: undefined;
			if (positionProperty === undefined && entry.position !== undefined) {
				return yield* reject("This media type tracks progress as a percent");
			}
			if (positionProperty !== undefined && entry.position === undefined) {
				return yield* reject("This media type tracks progress as a position");
			}
			if (positionProperty !== undefined && entry.progressPercent !== undefined) {
				return yield* reject("This media type tracks progress as a position");
			}
			return [
				{
					entityId: entry.entityId,
					eventSchemaSlug: "progress",
					properties: {
						...(entry.consumedOn === undefined ? {} : { consumedOn: entry.consumedOn }),
						...(entry.progressPercent === undefined
							? {}
							: { progressPercent: entry.progressPercent }),
						...(positionProperty === undefined || entry.position === undefined
							? {}
							: { [positionProperty]: entry.position }),
					},
				},
			];
		}
		const { schemaSlug } = yield* findTarget(host, entry.parentEntityId);
		const config = episodicConfigs[schemaSlug];
		if (config === undefined) {
			return yield* reject("Episodes can only be logged on shows and podcasts");
		}
		const members = yield* executeRyotqlRecipe(
			host.executeRyotql,
			episodeMembersRecipe({
				config,
				parentEntityId: entry.parentEntityId,
				episodeEntityIds: entry.episodeEntityIds,
			}),
		);
		if (members !== entry.episodeEntityIds.length) {
			return yield* reject("Every episode must belong to the selected parent");
		}
		return [...entry.episodeEntityIds]
			.sort()
			.map((id) => completeEvent(id, entry.when, submittedAt, entry));
	});

const writeInChunks = (
	events: readonly CreateEventItem[],
	options: { readonly submittedAt: string; readonly submissionId: string },
	host: ActivityHost,
) =>
	Effect.gen(function* () {
		let count = 0;
		for (let start = 0; start < events.length; start += EVENT_MUTATION_SANDBOX_LIMITS.items) {
			const chunk = events.slice(start, start + EVENT_MUTATION_SANDBOX_LIMITS.items);
			const written = yield* host
				.createEvents(chunk, {
					submittedAt: options.submittedAt,
					idempotencyKey: `${options.submissionId}:${start / EVENT_MUTATION_SANDBOX_LIMITS.items}`,
				})
				.pipe(Effect.catch(recoverPartialCreateEvents));
			count += written.count;
			if (written.count !== chunk.length) {
				return { count, status: "incomplete" as const };
			}
		}
		return { count, status: "saved" as const };
	});

export const manifest = defineManifest({
	kind: "operation",
	name: "Log media activity",
	slug: "operation.media-activity-log",
});

export default defineOperation({
	manifest,
	input: MediaActivityLogInput,
	output: MediaActivityLogOutput,
	run: (input, host) =>
		buildEvents(input, host).pipe(Effect.flatMap((events) => writeInChunks(events, input, host))),
});
