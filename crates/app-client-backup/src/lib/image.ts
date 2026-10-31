import { useQuery } from "@tanstack/react-query";

import { useContractClient } from "@/lib/contract-client";

import type { EntityImage } from "./entity-image";

type ImageEntry = { id: string; image: EntityImage };

export function useResolvedImageUrls(entries: ImageEntry[]) {
	const runContract = useContractClient();

	const s3Keys = Array.from(
		new Set(
			entries
				.map((e) => (e.image?.type === "s3" ? e.image.key : null))
				.filter((key): key is string => !!key),
		),
	);

	const presignedQuery = useQuery({
		staleTime: 14 * 60 * 1000,
		enabled: s3Keys.length > 0,
		queryKey: ["presigned-downloads", s3Keys],
		queryFn: () =>
			runContract((client) =>
				client.uploads.createPresignedDownload({ payload: { keys: s3Keys } }),
			),
	});

	const urlByKey = new Map<string, string>();
	for (const item of presignedQuery.data ?? []) {
		urlByKey.set(item.key, item.downloadUrl);
	}

	const imageUrlById = new Map<string, string | undefined>();
	for (const entry of entries) {
		if (entry.image?.type === "remote") {
			imageUrlById.set(entry.id, entry.image.url);
		} else if (entry.image?.type === "s3") {
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
