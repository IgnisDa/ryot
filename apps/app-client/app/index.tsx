import { Redirect } from "expo-router";
import { useAtomValue } from "jotai";
import { serverUrlAtom } from "@/lib/atoms";

export default function Index() {
	const serverUrl = useAtomValue(serverUrlAtom);
	if (!serverUrl) {
		return <Redirect href="/onboarding" />;
	}
	return <Redirect href="/(app)" />;
}
