import { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import type { mountPluginPage } from "@ryot-app/plugin-client-sdk/testing";

export const replyReportingPreferences = (
	page: Pick<ReturnType<typeof mountPluginPage>, "send" | "clientMessages">,
	answered: Set<string>,
	timeZone = TimeZone.make("UTC"),
) => {
	for (const request of page.clientMessages()) {
		if (request.type === "reporting-preferences-request" && !answered.has(request.requestId)) {
			answered.add(request.requestId);
			page.send({
				outcome: "success",
				preferences: { timeZone },
				type: "reporting-preferences-result",
				requestId: request.requestId,
			});
		}
	}
};
