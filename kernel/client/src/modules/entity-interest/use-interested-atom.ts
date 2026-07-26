import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { Atom } from "effect/unstable/reactivity";

import { useEntityRefresh } from "./use-entity-refresh";

type UseInterestedAtomProps<State> = {
	readonly blocked?: boolean;
	readonly atom: Atom.Atom<State>;
	readonly selectEntityIds: (state: State) => readonly string[];
};

export function useInterestedAtom<State>(props: UseInterestedAtomProps<State>) {
	const state = useAtomValue(props.atom);
	const refresh = useAtomRefresh(props.atom);

	useEntityRefresh({
		refresh,
		identity: props.atom,
		blocked: props.blocked ?? false,
		entityIds: props.selectEntityIds(state),
	});

	return { state, refresh };
}
