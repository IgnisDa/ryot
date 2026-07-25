type MediaActivityVerb = "read" | "play" | "watch" | "listen";

type MediaActivityVerbCopy = {
	readonly object: string;
	readonly gerund: string;
	readonly participle: string;
	readonly segmentNoun: string;
	readonly recordLabel: string;
	readonly completionsLabel: string;
};

const MEDIA_ACTIVITY_VERBS: Record<MediaActivityVerb, MediaActivityVerbCopy> = {
	read: {
		object: "read",
		gerund: "reading",
		participle: "read",
		segmentNoun: "Read",
		completionsLabel: "Reads",
		recordLabel: "Reading record",
	},
	play: {
		object: "play",
		gerund: "playing",
		segmentNoun: "Play",
		participle: "played",
		recordLabel: "Play record",
		completionsLabel: "Playthroughs",
	},
	watch: {
		object: "watch",
		gerund: "watching",
		segmentNoun: "Watch",
		participle: "watched",
		recordLabel: "Watch record",
		completionsLabel: "Watches",
	},
	listen: {
		object: "listen to",
		gerund: "listening",
		segmentNoun: "Listen",
		participle: "listened",
		completionsLabel: "Listens",
		recordLabel: "Listen record",
	},
};

const mediaActivityCopy = (verb: MediaActivityVerbCopy, noun: string) => ({
	segmentNoun: verb.segmentNoun,
	recordLabel: verb.recordLabel,
	loadingDetail: `Fetching everything you have recorded for this ${noun}.`,
	rowLabels: { review: `Reviewed the ${noun}`, completion: `Finished the ${noun}` },
	emptyDetail: `Nothing has been recorded for this ${noun}. Whatever you ${verb.object} will appear here as your ${verb.recordLabel.toLowerCase()}.`,
});

const mediaActivityBeats = (verb: MediaActivityVerbCopy, noun: string) => ({
	dropped: `Stopped ${verb.gerund}`,
	on_hold: `Put this ${noun} on hold`,
});

export const mediaFlatActivityCopy = <Extra = unknown>(input: {
	readonly noun: string;
	readonly verb: MediaActivityVerb;
	readonly progress?: (percent: string | undefined, extra: Extra) => string;
}) => {
	const verb = MEDIA_ACTIVITY_VERBS[input.verb];
	const { rowLabels, ...copy } = mediaActivityCopy(verb, input.noun);
	const progress: (percent: string | undefined, extra: Extra) => string =
		input.progress ??
		((percent) =>
			percent === undefined
				? `Part-way through the ${input.noun}`
				: `${percent}% through the ${input.noun}`);
	return {
		...copy,
		progressVerb: verb.participle,
		rowLabels: { ...rowLabels, progress },
		completionsLabel: verb.completionsLabel,
		beats: mediaActivityBeats(verb, input.noun),
	};
};

export const mediaEpisodicActivityCopy = (input: {
	readonly noun: string;
	readonly verb: MediaActivityVerb;
	readonly watchedLabel: string;
}) => {
	const verb = MEDIA_ACTIVITY_VERBS[input.verb];
	const { rowLabels, ...copy } = mediaActivityCopy(verb, input.noun);
	return {
		...copy,
		rowLabels: { ...rowLabels, watched: input.watchedLabel },
		figures: { time: "Time", episodes: "Episodes", watches: verb.completionsLabel },
		beats: { ...mediaActivityBeats(verb, input.noun), backlog: "Added to backlog" },
	};
};

export const mediaCreatorActivityCopy = (noun: string) => ({
	segmentNoun: "Activity",
	recordLabel: "Activity record",
	rowLabels: { review: `Reviewed this ${noun}` },
	loadingDetail: `Fetching everything you have recorded for this ${noun}.`,
	emptyDetail: `Nothing has been recorded for this ${noun}. Your reviews and collection changes will appear here.`,
});
