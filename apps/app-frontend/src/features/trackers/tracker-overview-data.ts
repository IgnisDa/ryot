import { useQueries } from "@tanstack/react-query";
import type { AppEntity } from "#/features/entities/model";
import {
	createEntityRuntimeRequest,
	toAppEntity,
} from "#/features/entities/model";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import type { AppEventSchema } from "#/features/event-schemas/model";
import { sortEventSchemas } from "#/features/event-schemas/model";
import type { AppEvent } from "#/features/events/model";
import { sortEvents, toAppEvent } from "#/features/events/model";
import { useSavedViewsQuery } from "#/features/saved-views/hooks";
import type { AppSavedView } from "#/features/saved-views/model";
import { useApiClient } from "#/hooks/api";
import type { AppTracker } from "./model";

interface TrackerOverviewActivity {
	date: Date;
	label: string;
	entityId: string;
	kind: "entity" | "event";
}

export interface TrackerOverviewSummary {
	count: number;
	schema: AppEntitySchema;
	savedView?: AppSavedView;
	latestEntity?: AppEntity;
	eventSchemaCount: number;
}

export interface TrackerOverviewEntityCard {
	entity: AppEntity;
	schema: AppEntitySchema;
	latestEvent?: AppEvent;
}

export interface TrackerOverviewData {
	isError: boolean;
	isLoading: boolean;
	totalEvents: number;
	totalEntities: number;
	lastActivityAt?: Date;
	primaryEntity?: AppEntity;
	totalEventSchemas: number;
	savedViews: AppSavedView[];
	primaryEntitySchema?: AppEntitySchema;
	primaryEventSchemas: AppEventSchema[];
	schemaSummaries: TrackerOverviewSummary[];
	recentActivities: TrackerOverviewActivity[];
	recentEntities: TrackerOverviewEntityCard[];
}

function sortEntitiesByRecent(entities: AppEntity[]) {
	return [...entities].sort((a, b) => {
		const updatedAtDiff = b.updatedAt.getTime() - a.updatedAt.getTime();
		if (updatedAtDiff !== 0) {
			return updatedAtDiff;
		}
		return b.createdAt.getTime() - a.createdAt.getTime();
	});
}

function getRelativeTimeLabel(date: Date) {
	const diffMs = date.getTime() - Date.now();
	const diffMinutes = Math.round(diffMs / 60000);
	const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

	if (Math.abs(diffMinutes) < 60) {
		return formatter.format(diffMinutes, "minute");
	}

	const diffHours = Math.round(diffMinutes / 60);
	if (Math.abs(diffHours) < 24) {
		return formatter.format(diffHours, "hour");
	}

	const diffDays = Math.round(diffHours / 24);
	if (Math.abs(diffDays) < 7) {
		return formatter.format(diffDays, "day");
	}

	const diffWeeks = Math.round(diffDays / 7);
	if (Math.abs(diffWeeks) < 5) {
		return formatter.format(diffWeeks, "week");
	}

	const diffMonths = Math.round(diffDays / 30);
	if (Math.abs(diffMonths) < 12) {
		return formatter.format(diffMonths, "month");
	}

	const diffYears = Math.round(diffDays / 365);
	return formatter.format(diffYears, "year");
}

export function useTrackerOverviewData(input: {
	tracker: AppTracker;
	entitySchemas: AppEntitySchema[];
}): TrackerOverviewData {
	const apiClient = useApiClient();
	const savedViewsQuery = useSavedViewsQuery();

	const entityQueries = useQueries({
		queries: input.entitySchemas.map((schema) =>
			apiClient.queryOptions("post", "/view-runtime/execute", {
				body: createEntityRuntimeRequest(schema.slug),
			}),
		),
	});

	const eventSchemaQueries = useQueries({
		queries: input.entitySchemas.map((schema) =>
			apiClient.queryOptions("get", "/event-schemas", {
				params: { query: { entitySchemaId: schema.id } },
			}),
		),
	});

	const entitiesWithSchema = entityQueries.flatMap((query, index) => {
		const schema = input.entitySchemas[index];
		if (!schema) {
			return [];
		}

		return (query.data?.data.items ?? []).map((entity) => ({
			entity: toAppEntity(entity),
			schema,
		}));
	});

	const allEntities = entitiesWithSchema.map((item) => item.entity);
	const entityById = new Map(allEntities.map((entity) => [entity.id, entity]));
	const schemaById = new Map(
		input.entitySchemas.map((schema) => [schema.id, schema]),
	);
	const recentEntities = sortEntitiesByRecent(allEntities).slice(0, 3);

	const allEntityEventQueries = useQueries({
		queries: allEntities.map((entity) =>
			apiClient.queryOptions("get", "/events", {
				params: { query: { entityId: entity.id } },
			}),
		),
	});

	const allEvents = allEntityEventQueries.flatMap((query) =>
		sortEvents((query.data?.data ?? []).map((event) => toAppEvent(event))),
	);
	const eventsByEntityId = new Map<string, AppEvent[]>();

	for (const event of allEvents) {
		const existing = eventsByEntityId.get(event.entityId) ?? [];
		eventsByEntityId.set(event.entityId, [...existing, event]);
	}

	const eventSchemasBySchemaId = new Map<string, AppEventSchema[]>();
	eventSchemaQueries.forEach((query, index) => {
		const schema = input.entitySchemas[index];
		if (!schema) {
			return;
		}

		eventSchemasBySchemaId.set(
			schema.id,
			sortEventSchemas(query.data?.data ?? []),
		);
	});

	const trackerSavedViews = savedViewsQuery.savedViews.filter(
		(view) => view.trackerId === input.tracker.id,
	);
	const recentActivity = [
		...allEvents.map((event) => ({
			date: event.occurredAt,
			kind: "event" as const,
			entityId: event.entityId,
			label: `${event.eventSchemaName} · ${entityById.get(event.entityId)?.name ?? "Unknown entity"}`,
		})),
		...entitiesWithSchema.map(({ entity }) => ({
			entityId: entity.id,
			date: entity.createdAt,
			kind: "entity" as const,
			label: `Added ${entity.name}`,
		})),
	]
		.sort((a, b) => b.date.getTime() - a.date.getTime())
		.slice(0, 5);

	const recentEntityCards = recentEntities
		.map((entity) => {
			const schema =
				schemaById.get(entity.entitySchemaId) ?? input.entitySchemas[0];
			return schema
				? { entity, latestEvent: eventsByEntityId.get(entity.id)?.[0], schema }
				: undefined;
		})
		.filter((card) => card !== undefined);

	const schemaSummaries = input.entitySchemas.map((schema) => {
		const entities = entitiesWithSchema
			.filter((item) => item.schema.id === schema.id)
			.map((item) => item.entity);
		const savedView = trackerSavedViews.find((view) =>
			view.queryDefinition.entitySchemaSlugs.includes(schema.slug),
		);

		return {
			schema,
			savedView,
			count: entities.length,
			latestEntity: sortEntitiesByRecent(entities)[0],
			eventSchemaCount: eventSchemasBySchemaId.get(schema.id)?.length ?? 0,
		};
	});

	const primaryEntitySchema = input.entitySchemas[0];
	const primaryEntities = entitiesWithSchema
		.filter((item) => item.schema.id === primaryEntitySchema?.id)
		.map((item) => item.entity);
	const primaryEntity = sortEntitiesByRecent(primaryEntities)[0];

	return {
		primaryEntity,
		schemaSummaries,
		primaryEntitySchema,
		savedViews: trackerSavedViews,
		totalEvents: allEvents.length,
		totalEntities: allEntities.length,
		recentEntities: recentEntityCards,
		recentActivities: recentActivity,
		lastActivityAt: recentActivity[0]?.date,
		primaryEventSchemas:
			eventSchemasBySchemaId.get(primaryEntitySchema?.id ?? "") ?? [],
		totalEventSchemas: Array.from(eventSchemasBySchemaId.values()).reduce(
			(total, eventSchemas) => total + eventSchemas.length,
			0,
		),
		isLoading:
			savedViewsQuery.isLoading ||
			entityQueries.some((query) => query.isLoading) ||
			eventSchemaQueries.some((query) => query.isLoading) ||
			allEntityEventQueries.some((query) => query.isLoading),
		isError:
			savedViewsQuery.isError ||
			entityQueries.some((query) => query.isError) ||
			eventSchemaQueries.some((query) => query.isError) ||
			allEntityEventQueries.some((query) => query.isError),
	};
}

export function getLastActivityLabel(date: Date | undefined) {
	if (!date) {
		return "No activity";
	}
	return getRelativeTimeLabel(date);
}

export function getActivityTimeLabel(activity: TrackerOverviewActivity) {
	return getRelativeTimeLabel(activity.date);
}
