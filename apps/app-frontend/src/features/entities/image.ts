import { useQueries } from "@tanstack/react-query";
import type { AppEntity } from "#/features/entities/model";
import { useApiClient } from "#/hooks/api";

export function useResolvedEntityImageUrls(entities: AppEntity[]) {
	const apiClient = useApiClient();
	const s3Keys = Array.from(
		new Set(
			entities
				.map((entity) =>
					entity.image?.kind === "s3" ? entity.image.key : null,
				)
				.filter((key): key is string => !!key),
		),
	);

	const presignedQueries = useQueries({
		queries: s3Keys.map((key) =>
			apiClient.queryOptions("get", "/uploads/presigned", {
				params: { query: { key } },
			}),
		),
	});

	const urlByKey = new Map<string, string>();
	presignedQueries.forEach((query, index) => {
		const key = s3Keys[index];
		const url = query.data?.data.uploadUrl;
		if (!key || !url) {
			return;
		}
		urlByKey.set(key, url);
	});

	const imageUrlByEntityId = new Map<string, string | undefined>();
	for (const entity of entities) {
		if (entity.image?.kind === "remote") {
			imageUrlByEntityId.set(entity.id, entity.image.url);
			continue;
		}

		if (entity.image?.kind === "s3") {
			imageUrlByEntityId.set(entity.id, urlByKey.get(entity.image.key));
			continue;
		}

		imageUrlByEntityId.set(entity.id, undefined);
	}

	return {
		imageUrlByEntityId,
		isError: presignedQueries.some((query) => query.isError),
		isLoading: presignedQueries.some((query) => query.isLoading),
	};
}

export function useResolvedEntityImageUrl(entity: AppEntity | undefined) {
	const query = useResolvedEntityImageUrls(entity ? [entity] : []);

	return {
		...query,
		imageUrl: entity ? query.imageUrlByEntityId.get(entity.id) : undefined,
	};
}
