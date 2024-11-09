import { Notifications, notifications } from "@mantine/notifications";
import { useEffect } from "react";
import { match } from "ts-pattern";
import type { Toast } from "~/lib/utilities.server";

export function Toaster(props: { toast?: Toast | null }) {
	return (
		<>
			<Notifications />
			{props.toast ? <ShowToast toast={props.toast} /> : null}
		</>
	);
}

const ShowToast = (props: { toast: Toast }) => {
	const { id, type, title, message, closeAfter } = props.toast;
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
				autoClose: closeAfter,
			});
		}, 0);
	}, [message, id, title, type]);
	return null;
};
