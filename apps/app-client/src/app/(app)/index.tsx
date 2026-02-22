import { Redirect } from "expo-router";

import { useWorkspace } from "@/modules/server/state";

export default function AppIndex() {
	const workspace = useWorkspace();
	return <Redirect href={{ pathname: "/[workspace]", params: { workspace } }} />;
}
