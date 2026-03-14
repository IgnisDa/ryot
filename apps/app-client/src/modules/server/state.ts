import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { serverUrlAtom, workspaceAtom } from "@/api/atoms";

export const useServerUrl = () => useAtomValue(serverUrlAtom);
export const useWorkspace = () => useAtomValue(workspaceAtom);
export const useSetServerUrl = () => useAtomSet(serverUrlAtom);
export const useSetWorkspace = () => useAtomSet(workspaceAtom);
