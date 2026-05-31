import { getQueryEngineField } from "@ryot/ts-utils/query-engine";
import { useQuery } from "@tanstack/react-query";

import { useApiClient } from "@/lib/api-client";
import { toEntityImage } from "@/lib/entity-image";
import { useResolvedImageUrls } from "@/lib/image";

import type { QueryEngineEntityItem } from "../entity-detail/query-engine";
import { MEDIA_SCOPE_SLUGS } from "./constants";

const CONTINUE_UNIT_LABELS: Record<string, string> = {
	book: "pages",
	show: "episodes",
	movie: "percent",
	music: "seconds",
	anime: "episodes",
	manga: "chapters",
	podcast: "episodes",
	audiobook: "minutes",
	"comic-book": "pages",
	"video-game": "percent",
	"visual-novel": "percent",
};

const formatNumber = (value: number) => {
	if (Number.isInteger(value)) {
		return value.toString();
	}
	return value
		.toFixed(2)
		.replace(/\.0+$/, "")
		.replace(/(\.\d*[1-9])0+$/, "$1");
};

const makeEntityCoalesceField = (key: string, path: string[]) => ({
	key,
	expression: {
		type: "coalesce" as const,
		values: MEDIA_SCOPE_SLUGS.map((slug) => ({
			type: "reference" as const,
			reference: { type: "entity" as const, slug, path },
		})),
	},
});

const COMMON_ENTITY_FIELDS = [
	makeEntityCoalesceField("entityId", ["id"]),
	makeEntityCoalesceField("entityName", ["name"]),
	makeEntityCoalesceField("entityImage", ["image"]),
	{
		key: "entitySchemaSlug",
		expression: {
			type: "reference" as const,
			reference: { type: "entity-schema" as const, path: ["slug"] },
		},
	},
];

function extractEntityBase(item: QueryEngineEntityItem | undefined) {
	const getVal = (key: string) => getQueryEngineField(item, key)?.value;
	const id = getVal("entityId");
	const title = getVal("entityName");
	const entitySchemaSlug = getVal("entitySchemaSlug");
	if (typeof id !== "string" || typeof title !== "string" || typeof entitySchemaSlug !== "string") {
		return null;
	}
	return {
		id,
		title,
		getVal,
		entitySchemaSlug,
		image: toEntityImage(getVal("entityImage")),
	};
}

const makeEventJoinColumnReference = (
	joinKey: string,
	column: "createdAt" | "id" | "occurredAt",
) => ({
	type: "reference" as const,
	reference: { type: "event-join" as const, joinKey, path: [column] },
});

const makeChronologicalComparisonPredicate = (leftJoinKey: string, rightJoinKey: string) => {
	const leftOccurredAt = makeEventJoinColumnReference(leftJoinKey, "occurredAt");
	const rightOccurredAt = makeEventJoinColumnReference(rightJoinKey, "occurredAt");
	const leftCreatedAt = makeEventJoinColumnReference(leftJoinKey, "createdAt");
	const rightCreatedAt = makeEventJoinColumnReference(rightJoinKey, "createdAt");
	const leftId = makeEventJoinColumnReference(leftJoinKey, "id");
	const rightId = makeEventJoinColumnReference(rightJoinKey, "id");

	return {
		type: "or" as const,
		predicates: [
			{ type: "isNull" as const, expression: rightOccurredAt },
			{
				left: leftOccurredAt,
				right: rightOccurredAt,
				operator: "gt" as const,
				type: "comparison" as const,
			},
			{
				type: "and" as const,
				predicates: [
					{
						left: leftOccurredAt,
						right: rightOccurredAt,
						operator: "eq" as const,
						type: "comparison" as const,
					},
					{
						left: leftCreatedAt,
						right: rightCreatedAt,
						operator: "gt" as const,
						type: "comparison" as const,
					},
				],
			},
			{
				type: "and" as const,
				predicates: [
					{
						left: leftOccurredAt,
						right: rightOccurredAt,
						operator: "eq" as const,
						type: "comparison" as const,
					},
					{
						left: leftCreatedAt,
						right: rightCreatedAt,
						operator: "eq" as const,
						type: "comparison" as const,
					},
					{ left: leftId, right: rightId, operator: "gt" as const, type: "comparison" as const },
				],
			},
		],
	};
};

export function useMediaOverviewData() {
	const apiClient = useApiClient();

	const upNextQuery = useQuery({
		queryKey: ["media", "overview", "up-next"],
		queryFn: async () => {
			const response = await apiClient.POST("/query-engine/execute", {
				body: {
					mode: "entities",
					scope: [...MEDIA_SCOPE_SLUGS],
					pagination: { page: 1, limit: 6 },
					eventJoins: [
						{ key: "backlog", kind: "latestEvent", eventSchemaSlug: "backlog" },
						{ key: "dropped", kind: "latestEvent", eventSchemaSlug: "dropped" },
						{ key: "on_hold", kind: "latestEvent", eventSchemaSlug: "on_hold" },
						{ key: "progress", kind: "latestEvent", eventSchemaSlug: "progress" },
						{ key: "complete", kind: "latestEvent", eventSchemaSlug: "complete" },
					],
					relationshipJoins: [
						{
							required: true,
							key: "inLibrary",
							direction: "outgoing",
							kind: "latestRelationship",
							relationshipSchemaSlug: "in-library",
						},
					],
					sort: {
						direction: "desc",
						expression: {
							type: "reference",
							reference: { type: "event-join", joinKey: "backlog", path: ["occurredAt"] },
						},
					},
					filter: {
						type: "and",
						predicates: [
							{
								type: "isNotNull",
								expression: {
									type: "reference",
									reference: { type: "event-join", joinKey: "backlog", path: ["occurredAt"] },
								},
							},
							makeChronologicalComparisonPredicate("backlog", "progress"),
							makeChronologicalComparisonPredicate("backlog", "complete"),
							makeChronologicalComparisonPredicate("backlog", "dropped"),
							makeChronologicalComparisonPredicate("backlog", "on_hold"),
						],
					},
					fields: [
						...COMMON_ENTITY_FIELDS,
						{
							key: "publishYear",
							expression: {
								type: "coalesce",
								values: [
									"book",
									"show",
									"movie",
									"anime",
									"manga",
									"music",
									"podcast",
									"audiobook",
									"comic-book",
								].map((slug) => ({
									type: "reference" as const,
									reference: {
										slug,
										type: "entity" as const,
										path: ["properties", "publishYear"],
									},
								})),
							},
						},
					],
				},
			});
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			const data = response.data;
			if (data.mode !== "entities") {
				return [];
			}
			return data.data.items.flatMap((item) => {
				const base = extractEntityBase(item);
				if (!base) {
					return [];
				}
				const { id, title, entitySchemaSlug, image, getVal } = base;

				const publishYearRaw = getVal("publishYear");
				const publishYear = typeof publishYearRaw === "number" ? publishYearRaw : null;

				return [
					{
						id,
						title,
						image,
						entitySchemaSlug,
						labels: { cta: "Start" },
						subtitle: {
							raw: publishYear,
							label: publishYear === null ? null : publishYear.toString(),
						},
					},
				];
			});
		},
	});

	const continueQuery = useQuery({
		queryKey: ["media", "overview", "continue"],
		queryFn: async () => {
			const response = await apiClient.POST("/query-engine/execute", {
				body: {
					mode: "entities",
					scope: [...MEDIA_SCOPE_SLUGS],
					relationshipJoins: [
						{
							key: "inLibrary",
							kind: "latestRelationship",
							relationshipSchemaSlug: "in-library",
							direction: "outgoing",
							required: true,
						},
					],
					eventJoins: [
						{ key: "backlog", kind: "latestEvent", eventSchemaSlug: "backlog" },
						{ key: "dropped", kind: "latestEvent", eventSchemaSlug: "dropped" },
						{ key: "on_hold", kind: "latestEvent", eventSchemaSlug: "on_hold" },
						{ key: "progress", kind: "latestEvent", eventSchemaSlug: "progress" },
						{ key: "complete", kind: "latestEvent", eventSchemaSlug: "complete" },
					],
					pagination: { page: 1, limit: 6 },
					sort: {
						direction: "desc",
						expression: {
							type: "reference",
							reference: { type: "event-join", joinKey: "progress", path: ["occurredAt"] },
						},
					},
					filter: {
						type: "and",
						predicates: [
							{
								type: "isNotNull",
								expression: {
									type: "reference",
									reference: { type: "event-join", joinKey: "progress", path: ["occurredAt"] },
								},
							},
							makeChronologicalComparisonPredicate("progress", "backlog"),
							makeChronologicalComparisonPredicate("progress", "complete"),
							makeChronologicalComparisonPredicate("progress", "dropped"),
							makeChronologicalComparisonPredicate("progress", "on_hold"),
						],
					},
					fields: [
						...COMMON_ENTITY_FIELDS,
						{
							key: "totalUnits",
							expression: {
								type: "coalesce",
								values: [
									{
										type: "reference",
										reference: { type: "entity", slug: "book", path: ["properties", "pages"] },
									},
									{
										type: "reference",
										reference: {
											type: "entity",
											slug: "comic-book",
											path: ["properties", "pages"],
										},
									},
									{
										type: "reference",
										reference: { type: "entity", slug: "anime", path: ["properties", "episodes"] },
									},
									{
										type: "reference",
										reference: { slug: "manga", type: "entity", path: ["properties", "chapters"] },
									},
									{
										type: "reference",
										reference: {
											type: "entity",
											slug: "audiobook",
											path: ["properties", "runtime"],
										},
									},
									{
										type: "reference",
										reference: {
											type: "entity",
											slug: "podcast",
											path: ["properties", "totalEpisodes"],
										},
									},
									{
										type: "reference",
										reference: {
											type: "entity",
											slug: "music",
											path: ["properties", "duration"],
										},
									},
								],
							},
						},
						{
							key: "progressPercent",
							expression: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "progress",
									path: ["properties", "progressPercent"],
								},
							},
						},
					],
				},
			});
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			const data = response.data;
			if (data.mode !== "entities") {
				return [];
			}
			return data.data.items.flatMap((item) => {
				const base = extractEntityBase(item);
				if (!base) {
					return [];
				}
				const { id, title, entitySchemaSlug, image, getVal } = base;

				const totalUnitsRaw = getVal("totalUnits");
				const totalUnits = typeof totalUnitsRaw === "number" ? totalUnitsRaw : null;

				const progressPercentRaw = getVal("progressPercent");
				const progressPercent = typeof progressPercentRaw === "number" ? progressPercentRaw : null;

				const currentUnitsRaw =
					totalUnits !== null && progressPercent !== null
						? (totalUnits * progressPercent) / 100
						: null;
				const currentUnits =
					currentUnitsRaw === null
						? null
						: Number.isInteger(totalUnits)
							? Math.round(currentUnitsRaw)
							: Math.round((currentUnitsRaw + Number.EPSILON) * 100) / 100;

				let progressLabel = "In progress";
				if (currentUnits !== null && totalUnits !== null) {
					const unitLabel = CONTINUE_UNIT_LABELS[entitySchemaSlug] ?? "units";
					progressLabel = `${formatNumber(currentUnits)} / ${formatNumber(totalUnits)} ${unitLabel}`;
				} else if (progressPercent !== null) {
					progressLabel = `${formatNumber(progressPercent)}% complete`;
				}

				return [
					{
						id,
						title,
						entitySchemaSlug,
						image,
						progress: { currentUnits, totalUnits, progressPercent },
						labels: {
							progress: progressLabel,
							cta:
								entitySchemaSlug === "show" || entitySchemaSlug === "anime"
									? "Next Episode"
									: "Log Progress",
						},
					},
				];
			});
		},
	});

	const rateTheseQuery = useQuery({
		queryKey: ["media", "overview", "review"],
		queryFn: async () => {
			const response = await apiClient.POST("/query-engine/execute", {
				body: {
					mode: "entities",
					scope: [...MEDIA_SCOPE_SLUGS],
					relationshipJoins: [
						{
							key: "inLibrary",
							kind: "latestRelationship",
							relationshipSchemaSlug: "in-library",
							direction: "outgoing",
							required: true,
						},
					],
					eventJoins: [
						{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
						{ key: "backlog", kind: "latestEvent", eventSchemaSlug: "backlog" },
						{ key: "progress", kind: "latestEvent", eventSchemaSlug: "progress" },
						{ key: "complete", kind: "latestEvent", eventSchemaSlug: "complete" },
						{ key: "dropped", kind: "latestEvent", eventSchemaSlug: "dropped" },
						{ key: "on_hold", kind: "latestEvent", eventSchemaSlug: "on_hold" },
					],
					pagination: { page: 1, limit: 6 },
					sort: {
						direction: "desc",
						expression: {
							type: "reference",
							reference: { type: "event-join", joinKey: "complete", path: ["occurredAt"] },
						},
					},
					filter: {
						type: "and",
						predicates: [
							{
								type: "isNotNull",
								expression: {
									type: "reference",
									reference: { type: "event-join", path: ["occurredAt"], joinKey: "complete" },
								},
							},
							makeChronologicalComparisonPredicate("complete", "backlog"),
							makeChronologicalComparisonPredicate("complete", "progress"),
							makeChronologicalComparisonPredicate("complete", "dropped"),
							makeChronologicalComparisonPredicate("complete", "on_hold"),
							makeChronologicalComparisonPredicate("complete", "review"),
						],
					},
					fields: [
						...COMMON_ENTITY_FIELDS,
						{
							key: "completeAt",
							expression: {
								type: "reference",
								reference: { type: "event-join", joinKey: "complete", path: ["occurredAt"] },
							},
						},
						{
							key: "reviewRating",
							expression: {
								type: "reference",
								reference: {
									joinKey: "review",
									type: "event-join",
									path: ["properties", "rating"],
								},
							},
						},
					],
				},
			});
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			const data = response.data;
			if (data.mode !== "entities") {
				return [];
			}
			return data.data.items.flatMap((item) => {
				const base = extractEntityBase(item);
				if (!base) {
					return [];
				}
				const { id, title, entitySchemaSlug, image, getVal } = base;

				const completeAt = getVal("completeAt");
				if (typeof completeAt !== "string") {
					return [];
				}

				const completedAt = completeAt;

				const ratingVal = getVal("reviewRating");
				const rating = typeof ratingVal === "number" ? ratingVal : null;

				return [
					{
						id,
						image,
						title,
						rating,
						completedAt,
						entitySchemaSlug,
					},
				];
			});
		},
	});

	const activityQuery = useQuery({
		queryKey: ["media", "overview", "activity"],
		queryFn: async () => {
			const response = await apiClient.POST("/query-engine/execute", {
				body: {
					mode: "events",
					scope: [...MEDIA_SCOPE_SLUGS],
					pagination: { page: 1, limit: 12 },
					eventSchemas: ["review", "backlog", "progress", "complete"],
					sort: {
						direction: "desc",
						expression: { type: "reference", reference: { type: "event", path: ["occurredAt"] } },
					},
					fields: [
						{
							key: "eventId",
							expression: { type: "reference", reference: { type: "event", path: ["id"] } },
						},
						{
							key: "eventOccurredAt",
							expression: { type: "reference", reference: { type: "event", path: ["occurredAt"] } },
						},
						{
							key: "eventSchemaSlug",
							expression: {
								type: "reference",
								reference: { type: "event-schema", path: ["slug"] },
							},
						},
						{
							key: "eventRating",
							expression: {
								type: "reference",
								reference: {
									type: "event",
									eventSchemaSlug: "review",
									path: ["properties", "rating"],
								},
							},
						},
						...COMMON_ENTITY_FIELDS,
					],
				},
			});
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			const data = response.data;
			if (data.mode !== "events") {
				return [];
			}
			return data.data.items.flatMap((item) => {
				const getVal = (key: string) => getQueryEngineField(item, key)?.value;

				const eventId = getVal("eventId");
				const entityId = getVal("entityId");
				const entityName = getVal("entityName");
				const occurredAt = getVal("eventOccurredAt");
				const eventSchemaSlug = getVal("eventSchemaSlug");
				const entitySchemaSlug = getVal("entitySchemaSlug");

				if (
					typeof eventId !== "string" ||
					typeof entityId !== "string" ||
					typeof entityName !== "string" ||
					typeof occurredAt !== "string" ||
					typeof eventSchemaSlug !== "string" ||
					typeof entitySchemaSlug !== "string"
				) {
					return [];
				}

				const ratingVal = getVal("eventRating");
				const rating = typeof ratingVal === "number" ? ratingVal : null;

				return [
					{
						rating,
						entityId,
						occurredAt,
						id: eventId,
						eventSchemaSlug,
						entity: {
							name: entityName,
							entitySchemaSlug,
							image: toEntityImage(getQueryEngineField(item, "entityImage")?.value),
						},
					},
				];
			});
		},
	});

	const upNextItems = upNextQuery.data ?? [];
	const continueItems = continueQuery.data ?? [];
	const activityItems = activityQuery.data ?? [];
	const rateTheseItems = rateTheseQuery.data ?? [];

	const imageEntries = [
		...upNextItems.map((item) => ({ id: item.id, image: item.image })),
		...continueItems.map((item) => ({ id: item.id, image: item.image })),
		...rateTheseItems.map((item) => ({ id: item.id, image: item.image })),
		...activityItems.map((item) => ({ id: item.entityId, image: item.entity.image })),
	];

	const {
		imageUrlById,
		isError: imagesError,
		isLoading: imagesLoading,
	} = useResolvedImageUrls(imageEntries);

	const entitySchemaSlugs = Array.from(
		new Set([
			...upNextItems.map((item) => item.entitySchemaSlug),
			...continueItems.map((item) => item.entitySchemaSlug),
			...rateTheseItems.map((item) => item.entitySchemaSlug),
			...activityItems.map((item) => item.entity.entitySchemaSlug),
		]),
	);

	const entitySchemasQuery = useQuery({
		enabled: entitySchemaSlugs.length > 0,
		queryKey: ["entity-schemas", entitySchemaSlugs],
		queryFn: async () => {
			const response = await apiClient.POST("/entity-schemas/list", {
				body: { slugs: entitySchemaSlugs },
			});
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			return response.data;
		},
	});

	const schemaColorMap = new Map<string, string>();
	for (const schema of entitySchemasQuery.data?.data ?? []) {
		schemaColorMap.set(schema.slug, schema.accentColor);
	}

	return {
		upNextItems,
		imageUrlById,
		activityItems,
		continueItems,
		rateTheseItems,
		schemaColorMap,
		isError:
			imagesError ||
			upNextQuery.isError ||
			activityQuery.isError ||
			continueQuery.isError ||
			rateTheseQuery.isError ||
			entitySchemasQuery.isError,
		isLoading:
			imagesLoading ||
			upNextQuery.isLoading ||
			activityQuery.isLoading ||
			continueQuery.isLoading ||
			rateTheseQuery.isLoading ||
			entitySchemasQuery.isLoading,
	};
}

export type MediaOverviewData = ReturnType<typeof useMediaOverviewData>;

export type ContinueItem = MediaOverviewData["continueItems"][number];

export type UpNextItem = MediaOverviewData["upNextItems"][number];

export type RateItem = MediaOverviewData["rateTheseItems"][number];

export type ActivityItem = MediaOverviewData["activityItems"][number];
