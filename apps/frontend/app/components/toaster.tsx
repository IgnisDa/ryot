import { Notifications, notifications } from "@mantine/notifications";
import { useEffect } from "react";
import { match } from "ts-pattern";
import { Toast } from "~/lib/toast.server";

export function Toaster({ toast }: { toast?: Toast | null }) {
	return (
		<>
			<Notifications />
			{toast ? <ShowToast toast={toast} /> : null}
		</>
	);
}

function ShowToast({ toast }: { toast: Toast }) {
	const { id, type, title, message } = toast;
	useEffect(() => {
		setTimeout(() => {
			const [defaultTitle, defaultColor] = match(type)
				.with("error", () => ["Error", "red"] as const)
				.with("message", () => ["Message", "blue"] as const)
				.with("success", () => ["Success", "green"] as const)
				.exhaustive();
			notifications.show({
				id,
				message,
				title: title ?? defaultTitle,
				color: defaultColor,
			});
		}, 0);
	}, [message, id, title, type]);
	return undefined;
}
