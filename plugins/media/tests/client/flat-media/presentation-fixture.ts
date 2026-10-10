import { Result } from "@ryot-app/client-sdk/effect";

import type { MediaPresentationSource } from "../../../shared/entity-presentations";

const presentationRowDefaults = {
	image: null,
	id: "media-1",
	name: "Fixture",
	publishDate: null,
	publishYear: null,
	progressPercent: 42,
	state: "in_progress",
	productionStatus: null,
	populationStatus: "ready",
	translationStatus: "none",
};

export const decodeFlatPresentation = <Presentation>(
	recipes: { readonly presentationSource: MediaPresentationSource<Presentation> },
	row: Record<string, unknown>,
) => {
	const decoded = Result.getOrThrow(
		recipes.presentationSource.decode({ ...presentationRowDefaults, ...row }),
	);
	return { ...decoded, batchAssets: [] };
};
