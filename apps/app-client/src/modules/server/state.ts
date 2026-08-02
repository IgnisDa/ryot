import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { normalizeServerOrigin } from "@/api/origin";
import { serverUrlAtom } from "@/modules/server/storage";

export const useServerUrl = () => useAtomValue(serverUrlAtom);
export const useSetServerUrl = () => {
	const setServerUrl = useAtomSet(serverUrlAtom);
	return (serverUrl: string | null) =>
		setServerUrl(serverUrl === null ? null : normalizeServerOrigin(serverUrl));
};
