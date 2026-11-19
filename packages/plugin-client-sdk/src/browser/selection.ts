import { useValueChange } from "@ryot-app/plugin-ui-sdk";
import type { EntityIdsResult } from "@ryot-app/ryotql-recipes/browse";
import { Effect } from "effect";
import { useState } from "react";

import { readCursorPages } from "../queries/cursor-pages";

export type EntitySelection =
	| { readonly kind: "ids"; readonly ids: ReadonlySet<string> }
	| { readonly kind: "matching"; readonly excluded: ReadonlySet<string> };

const emptySelection: EntitySelection = { kind: "ids", ids: new Set() };

const toggled = (values: ReadonlySet<string>, id: string) => {
	const next = new Set(values);
	if (!next.delete(id)) {
		next.add(id);
	}
	return next;
};

export const selectedCount = (selection: EntitySelection, total: number | undefined) => {
	if (selection.kind === "ids") {
		return selection.ids.size;
	}
	return total === undefined ? undefined : Math.max(0, total - selection.excluded.size);
};

export const resolveSelection = <E>(
	selection: EntitySelection,
	readIds: (after: string | undefined) => Effect.Effect<EntityIdsResult, E>,
) =>
	selection.kind === "ids"
		? Effect.succeed([...selection.ids])
		: Effect.map(readCursorPages(readIds), ({ items }) =>
				items.filter((id) => !selection.excluded.has(id)),
			);

export const useEntitySelection = (resetKey: string) => {
	const [selection, setSelection] = useState<null | EntitySelection>(null);
	useValueChange(resetKey, () =>
		setSelection((current) => (current === null ? null : emptySelection)),
	);
	return {
		selection,
		exit: () => setSelection(null),
		start: () => setSelection(emptySelection),
		clear: () => setSelection(emptySelection),
		selectMatching: () => setSelection({ kind: "matching", excluded: new Set() }),
		selectIds: (ids: readonly string[]) => setSelection({ kind: "ids", ids: new Set(ids) }),
		isSelected: (id: string) =>
			selection !== null &&
			(selection.kind === "ids" ? selection.ids.has(id) : !selection.excluded.has(id)),
		toggle: (id: string) =>
			setSelection((current) => {
				if (current === null) {
					return current;
				}
				return current.kind === "ids"
					? { kind: "ids", ids: toggled(current.ids, id) }
					: { kind: "matching", excluded: toggled(current.excluded, id) };
			}),
	};
};
