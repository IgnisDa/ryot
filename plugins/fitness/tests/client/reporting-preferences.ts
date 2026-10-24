import type { mountPluginPage } from "@ryot-app/plugin-client-sdk/testing";

export const replyReportingPreferences = (
	page: Pick<ReturnType<typeof mountPluginPage>, "send" | "clientMessages">,
	answered: Set<string>,
	timeZone = "UTC",
) => {
	for (const request of page.clientMessages()) {
		if (
			request.type === "user-settings-request" &&
			"kind" in request &&
			!answered.has(request.requestId)
		) {
			answered.add(request.requestId);
			page.send({
				outcome: "success",
				settings: { timeZone },
				type: "user-settings-result",
				requestId: request.requestId,
			});
		}
	}
};
