import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { serverUrlAtom } from "@/modules/server/storage";

import { normalizeServerOrigin } from "./url";

export const useServerUrl = () => useAtomValue(serverUrlAtom);
export const useSetServerUrl = () => {
	const setServerUrl = useAtomSet(serverUrlAtom);
	return (serverUrl: string | null) =>
		setServerUrl(serverUrl === null ? null : normalizeServerOrigin(serverUrl));
};
