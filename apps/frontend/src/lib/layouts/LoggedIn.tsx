import { useCookies } from "react-cookie";
import { useEffect, type ReactElement } from "react";
import { useRouter } from "next/router";
import { notifications } from "@mantine/notifications";

const Layout = ({ children }: { children: ReactElement }) => {
	return <>Layout {children}</>;
};

export default function (page: ReactElement) {
	const router = useRouter();
	const [{ auth }] = useCookies(["auth"]);

	useEffect(() => {
		if (!auth) {
			// This runs twice in dev mode?? Works fine production???
			// https://stackoverflow.com/questions/72238175/why-useeffect-running-twice-and-how-to-handle-it-well-in-react
			notifications.show({
				title: "Authorization error",
				message: "You are not logged in",
				color: "violet",
			});
			router.push("/auth/login");
		}
	}, []);

	return <Layout>{page}</Layout>;
}
