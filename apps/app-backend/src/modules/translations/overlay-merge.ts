import type { TranslationStatus } from "#modules/entities/schemas";
import type { StoredEntityImage } from "#modules/entities/types";

export type TranslationFields = {
	readonly name: string;
	readonly description: string | null;
	readonly image: StoredEntityImage | null;
};

type TranslationOverlayRow = {
	readonly name: string | null;
	readonly description: string | null;
	readonly image: StoredEntityImage | null;
};

type OverlayMergeResult = {
	readonly fields: TranslationFields;
	readonly status: TranslationStatus;
};

export const mergeTranslationOverlay = (input: {
	readonly canonical: TranslationFields;
	readonly overlay: TranslationOverlayRow | null;
}): OverlayMergeResult => {
	const { canonical, overlay } = input;

	if (overlay === null) {
		return { fields: canonical, status: "pending" };
	}

	const hasTranslation =
		overlay.name !== null || overlay.description !== null || overlay.image !== null;
	if (!hasTranslation) {
		return { fields: canonical, status: "none" };
	}

	return {
		status: "ready",
		fields: {
			name: overlay.name ?? canonical.name,
			image: overlay.image ?? canonical.image,
			description: overlay.description ?? canonical.description,
		},
	};
};
