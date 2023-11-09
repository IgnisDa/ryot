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
			notifications.show({
				id,
				message,
				title:
					title ??
					match(type)
						.with("error", () => "Error")
						.with("message", () => "Message")
						.with("success", () => "Success")
						.exhaustive(),
				color: match(type)
					.with("error", () => "red")
					.with("message", () => "blue")
					.with("success", () => "green")
					.exhaustive(),
			});
		}, 0);
	}, [message, id, title, type]);
	return null;
}
