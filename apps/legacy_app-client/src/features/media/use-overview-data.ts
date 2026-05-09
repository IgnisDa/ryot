import { useQuery } from "@tanstack/react-query";

import { useApiClient } from "@/lib/api-client";
import { toEntityImage, useResolvedImageUrls } from "@/lib/image";

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
			const response = await apiClient.GET("/media/overview/review");
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			return response.data;
		},
	});

	const activityQuery = useQuery({
		queryKey: ["media", "overview", "activity"],
		queryFn: async () => {
			const response = await apiClient.GET("/media/overview/activity");
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			return response.data;
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

	const rateTheseItems = (rateTheseQuery.data?.data.items ?? []).map((item) => ({
		id: item.id,
		title: item.title,
		rating: item.rating,
		completedAt: item.completedAt,
		image: toEntityImage(item.image),
		entitySchemaSlug: item.entitySchemaSlug,
	}));

	const activityItems = (activityQuery.data?.data.items ?? []).map((item) => ({
		id: item.id,
		rating: item.rating,
		entityId: item.entityId,
		occurredAt: item.occurredAt,
		eventSchemaSlug: item.eventSchemaSlug,
		entity: {
			name: item.entity.name,
			image: toEntityImage(item.entity.image),
			entitySchemaSlug: item.entity.entitySchemaSlug,
		},
	}));

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
