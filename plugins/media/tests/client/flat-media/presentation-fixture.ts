import { Result } from "@ryot-app/plugin-client-sdk/effect";

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
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
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
