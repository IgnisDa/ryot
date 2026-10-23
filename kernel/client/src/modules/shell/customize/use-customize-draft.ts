import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { useState } from "react";

import { buildCustomizePlan } from "#/modules/shell/customize/customize-plan";
import {
	type CustomizeDraft,
	type CustomizeSection,
	initCustomizeDraft,
	isCustomizeDraftDirty,
	moveCustomizeItem,
	toggleCustomizeItem,
} from "#/modules/shell/customize/customize-state";
import { CustomizeSidebarService } from "#/modules/shell/customize/service";

const SAVE_ERROR = "Could not save sidebar changes.";

type Session = {
	readonly active: boolean;
	readonly draft: CustomizeDraft;
	readonly initial: CustomizeDraft;
};

export type CustomizeDraftState = ReturnType<typeof useCustomizeDraft>;

export function useCustomizeDraft(props: {
	readonly active: boolean;
	readonly data: NavigationData;
	readonly catalog: PluginClientCatalog;
	readonly workspaceInstallationId: string | undefined;
}) {
	const { scope } = useRouteContext({ from: "/_authenticated" });
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [session, setSession] = useState<Session>(() => {
		const initial = initCustomizeDraft(props);
		return { initial, draft: initial, active: props.active };
	});

	// Entering or leaving the route starts a new editing session, so the draft is reseeded from the
	// navigation data that is current at that moment rather than from the data this hook first saw.
	if (session.active !== props.active) {
		const initial = initCustomizeDraft(props);
		setSession({ initial, draft: initial, active: props.active });
		setError(null);
	}

	const setDraft = (next: (draft: CustomizeDraft) => CustomizeDraft) =>
		setSession((current) => ({ ...current, draft: next(current.draft) }));

	const move = (section: CustomizeSection, fromIndex: number, toIndex: number) =>
		setDraft((draft) => moveCustomizeItem({ draft, section, toIndex, fromIndex }));

	const toggle = (section: CustomizeSection, id: string) =>
		setDraft((draft) => toggleCustomizeItem({ id, draft, section }));

	const isDirty = isCustomizeDraftDirty(session);

	const save = () => {
		if (!isDirty) {
			return Effect.succeed(true);
		}
		if (isSaving) {
			return Effect.succeed(false);
		}
		setError(null);
		setIsSaving(true);
		const plan = buildCustomizePlan({
			...session,
			workspaceInstallationId: props.workspaceInstallationId,
		});
		return Effect.flatMap(CustomizeSidebarService, (service) => service.save(scope, plan)).pipe(
			Effect.match({
				onSuccess: () => {
					setIsSaving(false);
					return true;
				},
				onFailure: () => {
					setIsSaving(false);
					setError(SAVE_ERROR);
					return false;
				},
			}),
		);
	};

	return { move, save, error, toggle, isDirty, isSaving, draft: session.draft };
}
