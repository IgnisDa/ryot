import { parameters } from "@ryot-app/plugin-kit/ryotql";

import { catalogMessage } from "./messages.generated";

export const mediaEntityParameters = parameters({
	fields: {
		entityId: {
			type: "string",
			validation: { required: true },
			description: "Media entity to read",
			label: catalogMessage("query-parameter.title"),
		},
	},
});

export const mediaDetailLimits = {
	groupLimit: 20,
	eventLimit: 60,
	peopleLimit: 12,
	companyLimit: 6,
	creditLimit: 12,
	collectionLimit: 6,
	coverageLimit: 100,
	watchDayLimit: 1000,
	parentEventLimit: 60,
	episodeEventLimit: 100,
	recommendationLimit: 12,
	collectionEventLimit: 60,
	episodeProgressLimit: 100,
} as const;

export const mediaGroupParameters = parameters({
	fields: {
		groupId: {
			type: "string",
			validation: { required: true },
			label: catalogMessage("query-parameter.group"),
			description: "Group whose member titles to read",
		},
	},
});
export const mediaEpisodeParameters = parameters({
	fields: {
		containerId: {
			type: "string",
			validation: { required: true },
			label: catalogMessage("query-parameter.parent"),
			description: "Season or podcast whose episodes to read",
		},
	},
});
