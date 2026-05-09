export type UmamiSettings = { readonly hostUrl: string; readonly websiteId: string };

export type UmamiEvent = {
	readonly url: string;
	readonly name?: string;
	readonly title?: string;
	readonly data?: Record<string, unknown>;
};

export type UmamiEnvironment = {
	readonly screen: string;
	readonly hostname: string;
	readonly language: string;
	readonly referrer: string;
};

export const umamiEndpoint = (hostUrl: string) => `${hostUrl.replace(/\/+$/, "")}/api/send`;

export const analyticsHostname = (serverUrl: string) => {
	try {
		return new URL(serverUrl).hostname;
	} catch {
		return serverUrl;
	}
};

export const umamiRequestBody = (options: {
	readonly event: UmamiEvent;
	readonly settings: UmamiSettings;
	readonly environment: UmamiEnvironment;
}) => ({
	type: "event",
	payload: {
		url: options.event.url,
		screen: options.environment.screen,
		website: options.settings.websiteId,
		hostname: options.environment.hostname,
		language: options.environment.language,
		referrer: options.environment.referrer,
		title: options.event.title ?? options.event.url,
		...(options.event.name === undefined ? {} : { name: options.event.name }),
		...(options.event.data === undefined ? {} : { data: options.event.data }),
	},
});
