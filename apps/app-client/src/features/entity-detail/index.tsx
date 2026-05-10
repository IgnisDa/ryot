import { useQuery } from "@tanstack/react-query";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useApiClient } from "@/lib/api-client";

import { loadRelatedCollections } from "./collections";
import { isEntitySchemaSlug, toEntityDetail } from "./model";
import { loadRelatedCreators, mergeCreators } from "./people";
import { EntityDetailTabs } from "./tabs";

function ScreenState(props: {
	title: string;
	action?: () => void;
	description: string;
	actionLabel?: string;
}) {
	return (
		<Box className="flex-1 items-center justify-center bg-background px-8">
			<Text className="text-center font-heading-semibold text-[18px] text-foreground">
				{props.title}
			</Text>
			<Text className="mt-2 text-center text-[14px] text-muted-foreground">
				{props.description}
			</Text>
			{props.action ? (
				<Pressable className="mt-5 rounded-full bg-[#C9943A] px-4 py-2" onPress={props.action}>
					<Text className="font-sans-semibold text-[13px] text-[#1c1917]">
						{props.actionLabel ?? "Retry"}
					</Text>
				</Pressable>
			) : null}
		</Box>
	);
}

export function EntityDetailScreen(props: { entityId: string }) {
	const apiClient = useApiClient();
	const entityId = props.entityId.trim();

	const entityQuery = useQuery({
		enabled: entityId.length > 0,
		queryKey: ["entity-detail", entityId],
		queryFn: async () => {
			const response = await apiClient.GET("/entities/{entityId}", {
				params: { path: { entityId } },
			});
			if (response.error) {
				throw new Error("Failed to load entity");
			}

			return response.data;
		},
	});

	const entitySchemaId = entityQuery.data?.data.entitySchemaId;
	const entitySchemaQuery = useQuery({
		enabled: !!entitySchemaId,
		queryKey: ["entity-schema", entitySchemaId],
		queryFn: async () => {
			if (!entitySchemaId) {
				throw new Error("Failed to resolve entity schema");
			}

			const response = await apiClient.GET("/entity-schemas/{entitySchemaId}", {
				params: { path: { entitySchemaId } },
			});
			if (response.error) {
				throw new Error("Failed to load entity schema");
			}

			return response.data;
		},
	});

	const relatedCreatorsQuery = useQuery({
		enabled: !!entityQuery.data?.data && !!entitySchemaQuery.data?.data.slug,
		queryKey: ["entity-detail", entityId, "people", entitySchemaQuery.data?.data.slug],
		queryFn: async () => {
			const entitySchemaSlug = entitySchemaQuery.data?.data.slug;
			const entityData = entityQuery.data?.data;
			if (!entityData || !entitySchemaSlug || !isEntitySchemaSlug(entitySchemaSlug)) {
				return [];
			}

			try {
				return await loadRelatedCreators(apiClient, { entityId, entitySchemaSlug });
			} catch {
				return [];
			}
		},
	});

	const relatedCollectionsQuery = useQuery({
		enabled: !!entityQuery.data?.data,
		queryKey: ["entity-detail", entityId, "collections"],
		queryFn: async () => {
			const entityData = entityQuery.data?.data;
			if (!entityData) {
				return [];
			}

			return loadRelatedCollections(apiClient, { entityId });
		},
	});

	if (!entityId) {
		return (
			<ScreenState description="The route did not include an entity id." title="Entity not found" />
		);
	}

	if (entityQuery.isLoading || entitySchemaQuery.isLoading) {
		return <ScreenState description="Loading live entity data." title="Loading entity" />;
	}

	if (entityQuery.isError) {
		return (
			<ScreenState
				actionLabel="Retry"
				title="Failed to load entity"
				action={() => void entityQuery.refetch()}
				description="We could not load this entity from the backend."
			/>
		);
	}

	if (entitySchemaQuery.isError) {
		return (
			<ScreenState
				actionLabel="Retry"
				title="Failed to load entity schema"
				action={() => void entitySchemaQuery.refetch()}
				description="We could not resolve the entity schema for this item."
			/>
		);
	}

	const entityData = entityQuery.data?.data;
	const entitySchemaSlug = entitySchemaQuery.data?.data.slug;
	const entity =
		entityData && entitySchemaSlug && isEntitySchemaSlug(entitySchemaSlug)
			? toEntityDetail(entityData, entitySchemaSlug)
			: null;
	const baseCreators = entity
		? "unlinkedCreators" in entity.properties
			? entity.properties.unlinkedCreators
			: []
		: [];
	const people = entity ? mergeCreators(baseCreators, relatedCreatorsQuery.data ?? []) : [];

	if (!entity) {
		return (
			<ScreenState
				title="Entity not supported"
				description="This entity type is not supported yet."
			/>
		);
	}

	return (
		<EntityDetailTabs
			entity={entity}
			creators={people}
			collections={relatedCollectionsQuery.data ?? null}
		/>
	);
}
