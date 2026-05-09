import { getQueryEngineField } from "@ryot/ts-utils";
import { useQuery } from "@tanstack/react-query";

import { useApiClient } from "@/lib/api-client";
import { toEntityImage, useResolvedImageUrls } from "@/lib/image";

const MEDIA_SCOPE_SLUGS = [
	"book",
	"show",
	"anime",
	"manga",
	"music",
	"movie",
	"person",
	"podcast",
	"audiobook",
	"comic-book",
	"video-game",
	"visual-novel",
];

export function useMediaOverviewData() {
	const apiClient = useApiClient();

	const upNextQuery = useQuery({
		queryKey: ["media", "overview", "up-next"],
		queryFn: async () => {
			const response = await apiClient.GET("/media/overview/up-next");
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			return response.data;
		},
	});

	const continueQuery = useQuery({
		queryKey: ["media", "overview", "continue"],
		queryFn: async () => {
			const response = await apiClient.GET("/media/overview/continue");
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			return response.data;
		},
	});

	const rateTheseQuery = useQuery({
		queryKey: ["media", "overview", "review"],
		queryFn: async () => {
			const response = await apiClient.POST("/query-engine/execute", {
				body: {
					mode: "entities",
					scope: MEDIA_SCOPE_SLUGS,
					relationships: [{ relationshipSchemaSlug: "in-library" }],
					eventJoins: [
						{ key: "review", kind: "latestEvent", eventSchemaSlug: "review" },
						{ key: "complete", kind: "latestEvent", eventSchemaSlug: "complete" },
					],
					pagination: { page: 1, limit: 6 },
					sort: {
						direction: "desc",
						expression: {
							type: "coalesce",
							values: [
								{
									type: "reference",
									reference: {
										type: "event-join",
										joinKey: "complete",
										path: ["properties", "completedOn"],
									},
								},
								{
									type: "reference",
									reference: {
										type: "event-join",
										joinKey: "complete",
										path: ["createdAt"],
									},
								},
							],
						},
					},
					filter: {
						type: "and",
						predicates: [
							{
								type: "isNotNull",
								expression: {
									type: "reference",
									reference: {
										type: "event-join",
										joinKey: "complete",
										path: ["createdAt"],
									},
								},
							},
							{
								type: "or",
								predicates: [
									{
										type: "isNull",
										expression: {
											type: "reference",
											reference: {
												type: "event-join",
												joinKey: "review",
												path: ["createdAt"],
											},
										},
									},
									{
										type: "comparison",
										operator: "gt",
										left: {
											type: "reference",
											reference: {
												type: "event-join",
												joinKey: "complete",
												path: ["properties", "completedOn"],
											},
										},
										right: {
											type: "reference",
											reference: {
												type: "event-join",
												joinKey: "review",
												path: ["createdAt"],
											},
										},
									},
								],
							},
						],
					},
					fields: [
						{
							key: "entityId",
							expression: {
								type: "coalesce",
								values: MEDIA_SCOPE_SLUGS.map((slug) => ({
									type: "reference" as const,
									reference: { type: "entity" as const, slug, path: ["id"] },
								})),
							},
						},
						{
							key: "entityName",
							expression: {
								type: "coalesce",
								values: MEDIA_SCOPE_SLUGS.map((slug) => ({
									type: "reference" as const,
									reference: { type: "entity" as const, slug, path: ["name"] },
								})),
							},
						},
						{
							key: "entityImage",
							expression: {
								type: "coalesce",
								values: MEDIA_SCOPE_SLUGS.map((slug) => ({
									type: "reference" as const,
									reference: { type: "entity" as const, slug, path: ["image"] },
								})),
							},
						},
						{
							key: "entitySchemaSlug",
							expression: {
								type: "reference",
								reference: { type: "entity-schema", path: ["slug"] },
							},
						},
						{
							key: "completeAt",
							expression: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "complete",
									path: ["createdAt"],
								},
							},
						},
						{
							key: "completedOn",
							expression: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "complete",
									path: ["properties", "completedOn"],
								},
							},
						},
						{
							key: "reviewRating",
							expression: {
								type: "reference",
								reference: {
									type: "event-join",
									joinKey: "review",
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
			const data = response.data.data;
			if (data.mode !== "entities") {
				return [];
			}
			return data.data.items.flatMap((item) => {
				const getVal = (key: string) => getQueryEngineField(item, key)?.value;

				const id = getVal("entityId");
				const title = getVal("entityName");
				const completeAt = getVal("completeAt");
				const entitySchemaSlug = getVal("entitySchemaSlug");

				if (
					typeof id !== "string" ||
					typeof title !== "string" ||
					typeof completeAt !== "string" ||
					typeof entitySchemaSlug !== "string"
				) {
					return [];
				}

				const completedOnVal = getVal("completedOn");
				const completedAt = typeof completedOnVal === "string" ? completedOnVal : completeAt;

				const ratingVal = getVal("reviewRating");
				const rating = typeof ratingVal === "number" ? ratingVal : null;

				return [
					{
						id,
						title,
						rating,
						completedAt,
						entitySchemaSlug,
						image: toEntityImage(getQueryEngineField(item, "entityImage")?.value),
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
					scope: MEDIA_SCOPE_SLUGS,
					pagination: { page: 1, limit: 12 },
					eventSchemas: ["review", "backlog", "progress", "complete"],
					sort: {
						direction: "desc",
						expression: { type: "reference", reference: { type: "event", path: ["createdAt"] } },
					},
					fields: [
						{
							key: "eventId",
							expression: { type: "reference", reference: { type: "event", path: ["id"] } },
						},
						{
							key: "eventCreatedAt",
							expression: { type: "reference", reference: { type: "event", path: ["createdAt"] } },
						},
						{
							key: "eventSchemaSlug",
							expression: {
								type: "reference",
								reference: { type: "event-schema", path: ["slug"] },
							},
						},
						{
							key: "eventCompletedOn",
							expression: {
								type: "reference",
								reference: {
									type: "event",
									eventSchemaSlug: "complete",
									path: ["properties", "completedOn"],
								},
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
						{
							key: "entityId",
							expression: {
								type: "coalesce",
								values: MEDIA_SCOPE_SLUGS.map((slug) => ({
									type: "reference" as const,
									reference: { type: "entity" as const, slug, path: ["id"] },
								})),
							},
						},
						{
							key: "entityName",
							expression: {
								type: "coalesce",
								values: MEDIA_SCOPE_SLUGS.map((slug) => ({
									type: "reference" as const,
									reference: { type: "entity" as const, slug, path: ["name"] },
								})),
							},
						},
						{
							key: "entityImage",
							expression: {
								type: "coalesce",
								values: MEDIA_SCOPE_SLUGS.map((slug) => ({
									type: "reference" as const,
									reference: { type: "entity" as const, slug, path: ["image"] },
								})),
							},
						},
						{
							key: "entitySchemaSlug",
							expression: {
								type: "reference",
								reference: { type: "entity-schema", path: ["slug"] },
							},
						},
					],
				},
			});
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			const data = response.data.data;
			if (data.mode !== "events") {
				return [];
			}
			return data.data.items.flatMap((item) => {
				const getVal = (key: string) => getQueryEngineField(item, key)?.value;

				const eventId = getVal("eventId");
				const entityId = getVal("entityId");
				const entityName = getVal("entityName");
				const eventCreatedAt = getVal("eventCreatedAt");
				const eventSchemaSlug = getVal("eventSchemaSlug");
				const entitySchemaSlug = getVal("entitySchemaSlug");

				if (
					typeof eventId !== "string" ||
					typeof entityId !== "string" ||
					typeof entityName !== "string" ||
					typeof eventCreatedAt !== "string" ||
					typeof eventSchemaSlug !== "string" ||
					typeof entitySchemaSlug !== "string"
				) {
					return [];
				}

				const completedOn = getVal("eventCompletedOn");
				const occurredAt =
					eventSchemaSlug === "complete" && typeof completedOn === "string"
						? completedOn
						: eventCreatedAt;

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

	const upNextItems = (upNextQuery.data?.data.items ?? []).map((item) => ({
		id: item.id,
		title: item.title,
		labels: item.labels,
		subtitle: item.subtitle,
		image: toEntityImage(item.image),
		entitySchemaSlug: item.entitySchemaSlug,
	}));

	const continueItems = (continueQuery.data?.data.items ?? []).map((item) => ({
		id: item.id,
		title: item.title,
		labels: item.labels,
		progress: item.progress,
		image: toEntityImage(item.image),
		entitySchemaSlug: item.entitySchemaSlug,
	}));

	const rateTheseItems = rateTheseQuery.data ?? [];

	const activityItems = activityQuery.data ?? [];

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
