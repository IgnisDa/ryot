import { useAtomValue } from "@effect/atom-react";
import { Redirect } from "expo-router";

import { useAuthClient } from "@/modules/auth/client";
import { scopedWorkspaceAtom } from "@/modules/navigation/atoms";
import { useServerUrl } from "@/modules/server/state";
import { CLOUD_URL } from "@/modules/server/url";

function WorkspaceRedirect(props: { serverUrl: string; userId: string }) {
	const workspace = useAtomValue(scopedWorkspaceAtom(props));
	return <Redirect href={{ pathname: "/[workspace]", params: { workspace } }} />;
}

export default function AppIndex() {
	const client = useAuthClient();
	const serverUrl = useServerUrl() ?? CLOUD_URL;
	const { data: session } = client.useSession();
	return session ? <WorkspaceRedirect serverUrl={serverUrl} userId={session.user.id} /> : null;
}
