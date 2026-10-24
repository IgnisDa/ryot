import { createRyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type {
	PluginIosLiveActivityListResult,
	PluginIosLiveActivityRequest,
} from "@ryot-app/plugin-client-sdk/plugin";

type Activity = Extract<
	PluginIosLiveActivityListResult,
	{ readonly status: "done" }
>["activities"][number];

export const iosLiveActivityHarness = (
	options: {
		readonly activities?: readonly Activity[];
		readonly onRequest?: (request: PluginIosLiveActivityRequest) => void;
		readonly fails?: boolean;
		readonly listResult?: () => unknown;
		readonly beforeRequest?: (
			request: PluginIosLiveActivityRequest,
		) => Effect.Effect<void, RyotClientError>;
	} = {},
) => {
	const requests: PluginIosLiveActivityRequest[] = [];
	const activities = new Map((options.activities ?? []).map((entry) => [entry.key, entry]));
	const client = createRyotClient({
		query: () => Effect.die("unused"),
		upload: () => Effect.die("unused"),
		iosLiveActivity: (request) =>
			Effect.gen(function* () {
				requests.push(request);
				options.onRequest?.(request);
				yield* options.beforeRequest?.(request) ?? Effect.void;
				if (options.fails) {
					return yield* new RyotClientError("transport");
				}
				if (request.action === "availability") {
					return { status: "available" };
				}
				if (request.action === "list") {
					return options.listResult === undefined
						? { status: "done", activities: [...activities.values()] }
						: options.listResult();
				}
				const previous = activities.get(request.key);
				if (request.action === "end") {
					activities.set(request.key, { state: "ended", key: request.key });
					return { status: "ended" };
				}
				if (previous?.state === "dismissed" || previous?.state === "ended") {
					return { status: previous.state };
				}
				if (request.action === "update" && previous === undefined) {
					return { status: "ended" };
				}
				activities.set(request.key, { state: "active", key: request.key });
				return { status: "active" };
			}),
	});
	return { requests, activities, api: client.iosLiveActivities };
};
