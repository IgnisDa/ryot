import { useAtomRefresh } from "@effect/atom-react";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import { Effect } from "effect";
import { useState } from "react";

import { useApiScope } from "@/api/scope";

import { navigationAtom } from "../atoms";
import { buildCustomizePlan } from "./customize-plan";
import {
	initCustomizeDraft,
	isCustomizeDraftDirty,
	moveCustomizeItem,
	toggleCustomizeItem,
	type CustomizeDraft,
	type CustomizeSection,
} from "./customize-state";
import { runCustomizePlan } from "./save";

const SAVE_ERROR = "Could not save sidebar changes.";

export function useCustomizeDraft(props: { data: NavigationData; workspaceSlug: string }) {
	const scope = useApiScope();
	const refreshNavigation = useAtomRefresh(navigationAtom(scope));
	const [initial] = useState<CustomizeDraft>(() => initCustomizeDraft(props));
	const [draft, setDraft] = useState<CustomizeDraft>(initial);
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const isDirty = isCustomizeDraftDirty({ draft, initial });

	function move(section: CustomizeSection, fromIndex: number, toIndex: number) {
		setDraft((current) => moveCustomizeItem({ draft: current, section, fromIndex, toIndex }));
	}

	function toggle(section: CustomizeSection, slug: string) {
		setDraft((current) => toggleCustomizeItem({ draft: current, section, slug }));
	}

	async function save() {
		if (!isDirty) {
			return true;
		}
		if (isSaving) {
			return false;
		}

		setError(null);
		setIsSaving(true);
		const plan = buildCustomizePlan({ draft, initial, workspaceSlug: props.workspaceSlug });
		try {
			const result = await Effect.runPromise(
				runCustomizePlan({ plan, scope }).pipe(
					Effect.match({
						onFailure: (failure) => ({ failure }) as const,
						onSuccess: () => ({ success: true }) as const,
					}),
				),
			);
			if ("failure" in result) {
				Effect.runSync(Effect.logWarning("customize sidebar save failed", result.failure));
				setError(SAVE_ERROR);
				return false;
			}

			refreshNavigation();
			return true;
		} catch (cause) {
			Effect.runSync(Effect.logWarning("customize sidebar save failed", cause));
			setError(SAVE_ERROR);
			return false;
		} finally {
			setIsSaving(false);
		}
	}

	return { draft, error, isDirty, isSaving, move, save, toggle };
}
