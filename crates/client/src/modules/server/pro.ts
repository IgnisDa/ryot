import { useAtomValue } from "@effect/atom-react";

import { useApiScope } from "@/api/scope";

import { systemConfigAtom } from "./atoms";
import { isServerKeyValidated } from "./pro-state";

/** The single client-side reader of Pro status; nothing else should read `pro.isServerKeyValidated` directly. */
export const useIsServerKeyValidated = () => {
	const { serverUrl } = useApiScope();
	return isServerKeyValidated(useAtomValue(systemConfigAtom(serverUrl)));
};
