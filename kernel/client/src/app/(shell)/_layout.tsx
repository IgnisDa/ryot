import { Stack } from "expo-router";

import { AuthenticatedLayout } from "@/modules/auth/authenticated-layout";

export default function ShellLayout() {
	return (
		<AuthenticatedLayout>
			<Stack screenOptions={{ headerShown: false }} />
		</AuthenticatedLayout>
	);
}
