import { RegistryContext } from "@effect/atom-react";
import { useContext, useEffect, useRef } from "react";

import { useApiScope } from "@/api/scope";
import { useDebouncedSearch } from "@/modules/ui/use-debounced-search";

import { savedViewSessionAtom } from "./atoms";
import type { SavedViewControllerState } from "./controller";
import {
	savedViewSessionEntry,
	withSavedViewController,
	withSavedViewQuery,
	withSavedViewScrollOffset,
	type SavedViewSessionEntry,
} from "./session-state";

export function useSavedViewSession(props: { slug: string; workspace: string }) {
	const scope = useApiScope();
	const registry = useContext(RegistryContext);
	const atom = savedViewSessionAtom(scope);
	const restored = useRef<SavedViewSessionEntry | null>(null);
	restored.current ??= savedViewSessionEntry(registry.get(atom), props.workspace, props.slug);
	const search = useDebouncedSearch(restored.current.query);
	const query = search.query;

	useEffect(() => {
		const session = registry.get(atom);
		if (savedViewSessionEntry(session, props.workspace, props.slug).query === query) {
			return;
		}
		registry.set(atom, withSavedViewQuery(session, props.workspace, props.slug, query));
	}, [atom, props.slug, props.workspace, query, registry]);

	return {
		initialController: restored.current.controller,
		initialScrollOffset: restored.current.scrollOffset,
		onControllerChange: (controller: SavedViewControllerState) =>
			registry.set(
				atom,
				withSavedViewController(registry.get(atom), props.workspace, props.slug, controller),
			),
		onScrollOffsetChange: (offset: number) =>
			registry.set(
				atom,
				withSavedViewScrollOffset(registry.get(atom), props.workspace, props.slug, offset),
			),
		search,
	};
}
