import { useQueries } from "@tanstack/react-query";
import type { AppEntity, AppEntityImage } from "~/features/entities/model";
import { useApiClient } from "~/hooks/api";

interface ImageEntry {
	id: string;
	image: AppEntityImage;
}

export function useResolvedImageUrls(imageEntries: ImageEntry[]) {
	const apiClient = useApiClient();
	const s3Keys = Array.from(
		new Set(
			imageEntries
				.map((entry) => (entry.image?.kind === "s3" ? entry.image.key : null))
				.filter((key): key is string => !!key),
		),
	);

	const presignedQueries = useQueries({
		queries: s3Keys.map((key) =>
			apiClient.queryOptions(
				"get",
				"/uploads/presigned",
				{ params: { query: { key } } },
				{ staleTime: 14 * 60 * 1000 /* 14m; URLs are valid for 15m */ },
			),
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
	for (const entry of imageEntries) {
		if (entry.image?.kind === "remote") {
			imageUrlByEntityId.set(entry.id, entry.image.url);
			continue;
		}

		if (entry.image?.kind === "s3") {
			imageUrlByEntityId.set(entry.id, urlByKey.get(entry.image.key));
			continue;
		}

		imageUrlByEntityId.set(entry.id, undefined);
	}

	return {
		imageUrlByEntityId,
		isError: presignedQueries.some((query) => query.isError),
		isLoading: presignedQueries.some((query) => query.isLoading),
	};
}

export function useResolvedEntityImageUrls(entities: AppEntity[]) {
	return useResolvedImageUrls(
		entities.map((entity) => ({ id: entity.id, image: entity.image })),
	);
}

export function useResolvedEntityImageUrl(entity: AppEntity | undefined) {
	const query = useResolvedEntityImageUrls(entity ? [entity] : []);

	return {
		...query,
		imageUrl: entity ? query.imageUrlByEntityId.get(entity.id) : undefined,
	};
}
