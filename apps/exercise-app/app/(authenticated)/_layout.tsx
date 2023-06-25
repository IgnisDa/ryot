import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";

export default function Layout() {
	const router = useRouter();
	const { authData, loading } = useAuth();

	useEffect(() => {
		if (!loading && !authData) router.push(ROUTES.setup);
	}, [authData, loading]);

	return <Stack screenOptions={{}} />;
}
