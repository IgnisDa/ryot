import { useQuery } from "@tanstack/react-query";

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

	const presignedQuery = useQuery(
		apiClient.queryOptions(
			"post",
			"/uploads/presigned/download",
			{ params: {}, body: { keys: s3Keys } },
			{
				enabled: s3Keys.length > 0,
				staleTime: 14 * 60 * 1000 /* 14m; URLs are valid for 15m */,
			},
		),
	);

	const urlByKey = new Map<string, string>();
	for (const item of presignedQuery.data?.data ?? []) {
		urlByKey.set(item.key, item.downloadUrl);
	}

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
		isError: presignedQuery.isError,
		isLoading: presignedQuery.isLoading,
	};
}

export function useResolvedEntityImageUrls(entities: AppEntity[]) {
	return useResolvedImageUrls(entities.map((entity) => ({ id: entity.id, image: entity.image })));
}

export function useResolvedEntityImageUrl(entity: AppEntity | undefined) {
	const query = useResolvedEntityImageUrls(entity ? [entity] : []);

	return {
		...query,
		imageUrl: entity ? query.imageUrlByEntityId.get(entity.id) : undefined,
	};
}
