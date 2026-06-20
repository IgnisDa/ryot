import { useAtomValue } from "@effect/atom-react";
import { Redirect } from "expo-router";

import { useApiScope } from "@/api/scope";
import { scopedWorkspaceAtom } from "@/modules/navigation/atoms";
import { getWorkspaceHref } from "@/modules/navigation/navigation-data";

export default function AppIndex() {
	const scope = useApiScope();
	const workspace = useAtomValue(scopedWorkspaceAtom(scope));
	return <Redirect href={getWorkspaceHref(workspace)} />;
}
