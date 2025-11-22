import type { TranslationStatus } from "#modules/entities/schemas";

export type TranslationFields = {
	readonly name: string;
	readonly properties: Record<string, unknown>;
};

type TranslationOverlayRow = {
	readonly name: string | null;
	readonly properties: Record<string, unknown>;
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

	const hasTranslation = overlay.name !== null || Object.keys(overlay.properties).length > 0;
	if (!hasTranslation) {
		return { fields: canonical, status: "none" };
	}

	return {
		status: "ready",
		fields: {
			name: overlay.name ?? canonical.name,
			properties: { ...canonical.properties, ...overlay.properties },
		},
	};
};
