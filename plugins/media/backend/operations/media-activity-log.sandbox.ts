import {
	type EventCreate,
	existingEntity,
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
	or,
	parameters,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { CONSUMED_ON_LIST_LIMIT, consumedOnSettingKey } from "../../shared/consumed-on-settings";
import { mediaPositionError } from "../../shared/consumption";
import { entityId } from "../../shared/entity-selections";
import { episodicEpisodeMembership } from "../../shared/episodic-recipes";
import {
	type EpisodicKindConfig,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import { mediaProgressRuleError } from "../../shared/media-activity-fields";
import {
	MediaActivityLogInput,
	MediaActivityLogOutput,
	type MediaActivityWhen,
} from "../../shared/media-activity-operations";
import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { catalogMessage } from "../../shared/messages.generated";
import { reject } from "../lib/failures";

const EPISODE_MEMBERSHIP_PAGE_SIZE = 100;

const episodicConfigs: Readonly<Record<string, EpisodicKindConfig>> = {
	show: showEpisodicKindConfig,
	podcast: podcastEpisodicKindConfig,
};

const lifecycleSchemaSlugs = new Set<string>(
	builtinMediaEntitySchemaSlugs.filter((slug) => !(slug in episodicConfigs)),
);
const targetRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			id: {
				type: "string",
				description: "id to read",
				validation: { required: true },
				label: catalogMessage("query-parameter.id"),
			},
		},
	});
	const entity = table("entity", "activityTarget");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ target }) => Result.succeed(target),
		queries: {
			target: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: { schemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String) },
				where: and(
					entityId(entity, inputParameters.value("id")),
					or(
						...builtinMediaEntitySchemaSlugs.map((slug) =>
							entitySchemaPredicate(entity, slug, { kind: "self" }),
						),
					),
				),
			}),
		},
	});
})();
const episodeMembersRecipe = (input: { readonly config: EpisodicKindConfig }) => {
	const inputParameters = parameters({
		fields: {
			parentEntityId: {
				type: "string",
				validation: { required: true },
				description: "parentEntityId to read",
				label: catalogMessage("query-parameter.parent"),
			},
			episodeEntityIds: {
				type: "array",
				validation: { required: true },
				description: "episodeEntityIds to read",
				label: catalogMessage("query-parameter.episodes"),
				items: {
					type: "string",
					description: "Selected ID",
					label: catalogMessage("query-parameter.id"),
				},
			},
		},
	});
	const episode = table("entity", "activityEpisode");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ members }) => Result.succeed(members.items.length),
		queries: {
			members: selectedRows(episode, {
				limit: EPISODE_MEMBERSHIP_PAGE_SIZE,
				orderBy: [ascending(column(episode, "id"))],
				selection: { id: selectedField(column(episode, "id"), Schema.String) },
				where: and(
					entitySchemaPredicate(episode, input.config.episodeSchemaSlug, { kind: "self" }),
					inArray(column(episode, "id"), inputParameters.list("episodeEntityIds")),
					episodicEpisodeMembership(
						input.config,
						episode,
						inputParameters.value("parentEntityId"),
						"activityMember",
					),
				),
			}),
		},
	});
};
type ActivityEvent = EventCreate;

const activityEvent = (
	id: string,
	event: Pick<ActivityEvent, "occurredAt" | "properties" | "eventSchemaSlug">,
): ActivityEvent => ({
	...event,
	kind: "create",
	entity: existingEntity(EntityId.make(id)),
	itemIdentity: `${event.eventSchemaSlug}:${id}`,
});

const completeEvent = (
	id: string,
	when: MediaActivityWhen,
	submittedAt: string,
	extras: {
		readonly timeSpent?: number | undefined;
		readonly consumedOn?: undefined | readonly string[];
	},
): ActivityEvent =>
	activityEvent(id, {
		eventSchemaSlug: "complete",
		occurredAt: when.kind === "date" ? when.finishedOn : submittedAt,
		properties: {
			...(extras.consumedOn === undefined ? {} : { consumedOn: extras.consumedOn }),
			...(extras.timeSpent === undefined ? {} : { timeSpent: extras.timeSpent }),
			...(when.kind === "date" && when.startedOn !== undefined
				? { startedOn: when.startedOn }
				: {}),
			...(when.kind === "unknown" ? { dateUnknown: true } : {}),
			...(when.kind === "date" && when.calendarDate !== undefined
				? { calendarDate: when.calendarDate }
				: {}),
		},
	});

type ActivityHost = Pick<ScriptHost, "executeRyotql">;

type SettingsHost = Pick<ScriptHost, "log" | "getUserSettings">;

type BuiltEvents = {
	readonly schemaSlug?: string | undefined;
	readonly events: readonly ActivityEvent[];
};

const findTarget = (host: ActivityHost, id: string) =>
	Effect.gen(function* () {
		const target = yield* executeRyotqlRecipe(host.executeRyotql, targetRecipe, { id: id });
		if (target === undefined) {
			return yield* reject(catalogMessage("rejection.activity.entity-not-found"));
		}
		return target;
	});

const buildEvents = (
	{ entry, submittedAt }: MediaActivityLogInput,
	host: ActivityHost,
): Effect.Effect<BuiltEvents, unknown> =>
	Effect.gen(function* () {
		if (entry.kind === "status") {
			yield* findTarget(host, entry.entityId);
			return {
				events: [activityEvent(entry.entityId, { properties: {}, eventSchemaSlug: entry.status })],
			};
		}
		if (entry.kind === "complete") {
			const { schemaSlug } = yield* findTarget(host, entry.entityId);
			if (!lifecycleSchemaSlugs.has(schemaSlug)) {
				return yield* reject(catalogMessage("rejection.activity.cannot-complete-directly"));
			}
			return {
				schemaSlug,
				events: [completeEvent(entry.entityId, entry.when, submittedAt, entry)],
			};
		}
		if (entry.kind === "progress") {
			const { schemaSlug } = yield* findTarget(host, entry.entityId);
			if (!lifecycleSchemaSlugs.has(schemaSlug)) {
				return yield* reject(catalogMessage("rejection.activity.no-progress"));
			}
			if (
				entry.progressPages !== undefined &&
				(!["book", "comic-book"].includes(schemaSlug) ||
					entry.progressPercent !== undefined ||
					entry.position !== undefined)
			) {
				return yield* reject(catalogMessage("rejection.activity.pages-conflict"));
			}
			const progressError = mediaProgressRuleError(
				schemaSlug,
				{ position: entry.position !== undefined, percent: entry.progressPercent !== undefined },
				true,
			);
			if (progressError !== undefined) {
				return yield* reject(progressError);
			}
			const positionError =
				entry.position === undefined ? undefined : mediaPositionError(schemaSlug, entry.position);
			if (positionError !== undefined) {
				return yield* reject(positionError);
			}
			return {
				schemaSlug,
				events: [
					activityEvent(entry.entityId, {
						eventSchemaSlug: "progress",
						occurredAt: entry.when?.kind === "date" ? entry.when.finishedOn : submittedAt,
						properties: {
							...(entry.when?.kind === "unknown" ? { dateUnknown: true } : {}),
							...(entry.when?.kind === "date" && entry.when.calendarDate !== undefined
								? { calendarDate: entry.when.calendarDate }
								: {}),
							...(entry.when?.kind === "date" && entry.when.startedOn !== undefined
								? { startedOn: entry.when.startedOn }
								: {}),
							...(entry.timeSpent === undefined ? {} : { timeSpent: entry.timeSpent }),
							...(entry.progressPages === undefined ? {} : { progressPages: entry.progressPages }),
							...(entry.consumedOn === undefined ? {} : { consumedOn: entry.consumedOn }),
							...(entry.progressPercent === undefined
								? {}
								: { progressPercent: entry.progressPercent }),
							...(entry.position === undefined ? {} : { position: entry.position }),
						},
					}),
				],
			};
		}
		const { schemaSlug } = yield* findTarget(host, entry.parentEntityId);
		const config = episodicConfigs[schemaSlug];
		if (config === undefined) {
			return yield* reject(catalogMessage("rejection.activity.episodes-unsupported"));
		}
		let members = 0;
		for (
			let start = 0;
			start < entry.episodeEntityIds.length;
			start += EPISODE_MEMBERSHIP_PAGE_SIZE
		) {
			members += yield* executeRyotqlRecipe(
				host.executeRyotql,
				episodeMembersRecipe({ config: config }),
				{
					parentEntityId: entry.parentEntityId,
					episodeEntityIds: entry.episodeEntityIds.slice(
						start,
						start + EPISODE_MEMBERSHIP_PAGE_SIZE,
					),
				},
			);
		}
		if (members !== entry.episodeEntityIds.length) {
			return yield* reject(catalogMessage("rejection.activity.episode-parent-mismatch"));
		}
		return {
			schemaSlug,
			events: entry.episodeEntityIds.map((id) => completeEvent(id, entry.when, submittedAt, entry)),
		};
	});

const rememberedConsumedOn = (
	host: SettingsHost,
	schemaSlug: string,
	consumedOn: readonly string[],
) =>
	Effect.gen(function* () {
		const key = consumedOnSettingKey(schemaSlug);
		if (key === undefined) {
			return undefined;
		}
		const settings = yield* host.getUserSettings();
		const current = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(settings[key]);
		const remembered = new Set(current.map((value) => value.toLowerCase()));
		const added: string[] = [];
		for (const value of consumedOn) {
			if (current.length + added.length >= CONSUMED_ON_LIST_LIMIT) {
				break;
			}
			if (!remembered.has(value.toLowerCase())) {
				remembered.add(value.toLowerCase());
				added.push(value);
			}
		}
		return added.length === 0 ? undefined : { [key]: [...current, ...added] };
	}).pipe(
		Effect.catch((error) =>
			host
				.log([
					{
						level: "warning",
						message: "Could not add the activity source to the user's settings",
						attributes: {
							schemaSlug,
							reason: error instanceof Error ? error.message : "Unknown failure",
						},
					},
				])
				.pipe(Effect.ignore, Effect.as(undefined)),
		),
	);

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
		Effect.gen(function* () {
			const { events, schemaSlug } = yield* buildEvents(input, host);
			const { entry } = input;
			const settings =
				schemaSlug !== undefined && entry.kind !== "status" && entry.consumedOn !== undefined
					? yield* rememberedConsumedOn(host, schemaSlug, entry.consumedOn)
					: undefined;
			return {
				output: { count: events.length },
				changes: { ...(settings === undefined ? {} : { settings }), events: { changes: events } },
			};
		}),
});
