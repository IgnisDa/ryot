import { parameters } from "@ryot-app/plugin-kit/ryotql";

export const mediaEntityParameters = parameters({
	fields: {
		entityId: {
			type: "string",
			label: "Title",
			validation: { required: true },
			description: "Media entity to read",
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
			label: "Group",
			validation: { required: true },
			description: "Group whose member titles to read",
		},
	},
});
export const mediaEpisodeParameters = parameters({
	fields: {
		containerId: {
			type: "string",
			label: "Container",
			validation: { required: true },
			description: "Season or podcast whose episodes to read",
		},
	},
});
