import type { TranslationStatus } from "#modules/entities/schemas";
import type { StoredEntityImage } from "#modules/entities/types";

export type TranslationFields = {
	readonly name: string;
	readonly description: string | null;
	readonly image: StoredEntityImage | null;
};

export type TranslationOverlayRow = {
	readonly name: string | null;
	readonly description: string | null;
	readonly image: StoredEntityImage | null;
};

export type OverlayMergeResult = {
	readonly fields: TranslationFields;
	readonly status: TranslationStatus;
};

/**
 * Merges a language overlay row over the canonical display fields.
 *
 * - No row → status `pending` (the caller should trigger a background fill).
 * - A row with at least one non-null field → merge name/description/image over
 *   the canonical fields, status `ready`.
 * - A row whose fields are all null (negative cache) → status `none`; render
 *   canonical and do not refetch.
 */
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
