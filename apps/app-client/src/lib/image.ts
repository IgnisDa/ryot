import { useQuery } from "@tanstack/react-query";

import { useApiClient } from "@/lib/api-client";

import type { EntityImage } from "./entity-image";

export type { EntityImage } from "./entity-image";
export { toEntityImage } from "./entity-image";

type ImageEntry = { id: string; image: EntityImage };

export function useResolvedImageUrls(entries: ImageEntry[]) {
	const apiClient = useApiClient();

	const s3Keys = Array.from(
		new Set(
			entries
				.map((e) => (e.image?.kind === "s3" ? e.image.key : null))
				.filter((key): key is string => !!key),
		),
	);

	const presignedQuery = useQuery({
		staleTime: 14 * 60 * 1000,
		enabled: s3Keys.length > 0,
		queryKey: ["presigned-downloads", s3Keys],
		queryFn: async () => {
			const response = await apiClient.POST("/uploads/presigned/download", {
				body: { keys: s3Keys },
			});
			if (response.error) {
				throw new Error(JSON.stringify(response.error));
			}
			return response.data;
		},
	});

	const urlByKey = new Map<string, string>();
	for (const item of presignedQuery.data?.data ?? []) {
		urlByKey.set(item.key, item.downloadUrl);
	}

	const imageUrlById = new Map<string, string | undefined>();
	for (const entry of entries) {
		if (entry.image?.kind === "remote") {
			imageUrlById.set(entry.id, entry.image.url);
		} else if (entry.image?.kind === "s3") {
			imageUrlById.set(entry.id, urlByKey.get(entry.image.key));
		} else {
			imageUrlById.set(entry.id, undefined);
		}
	}

	return {
		imageUrlById,
		isError: s3Keys.length > 0 && presignedQuery.isError,
		isLoading: s3Keys.length > 0 && presignedQuery.isLoading,
	};
}
