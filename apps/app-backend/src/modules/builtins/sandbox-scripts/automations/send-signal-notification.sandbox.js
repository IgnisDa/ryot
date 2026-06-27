function signalMessage(signal) {
	const properties = signal.properties;
	const episodeLabel =
		typeof properties.seasonNumber === "number"
			? "S" + properties.seasonNumber + "E" + properties.episodeNumber
			: "EP" + properties.episodeNumber;
	if (signal.schema.slug === "integration.disabled") {
		return "Integration " + properties.providerName + " has been disabled due to too many errors";
	}
	if (signal.schema.slug === "review.created") {
		return "Review created for " + properties.entityName;
	}
	if (signal.schema.slug === "workout.created") {
		return "Workout created: " + properties.workoutName;
	}
	if (signal.schema.slug === "media.status.changed") {
		return (
			"Status of " +
			properties.entityName +
			" changed from " +
			properties.oldStatus +
			" to " +
			properties.newStatus
		);
	}
	if (signal.schema.slug === "media.content-count.changed") {
		return (
			"Number of " +
			properties.contentType +
			" changed from " +
			properties.oldCount +
			" to " +
			properties.newCount +
			" for " +
			properties.entityName
		);
	}
	if (signal.schema.slug === "media.release-date.changed") {
		return properties.changeKind === "publish_year"
			? "Publish year changed from " +
					properties.oldYear +
					" to " +
					properties.newYear +
					" for " +
					properties.entityName
			: "Episode release date changed from " +
					properties.oldDate +
					" to " +
					properties.newDate +
					" (" +
					episodeLabel +
					") for " +
					properties.entityName;
	}
	if (signal.schema.slug === "media.episode.name.changed") {
		return (
			"Episode name changed from " +
			JSON.stringify(properties.oldName) +
			" to " +
			JSON.stringify(properties.newName) +
			" (" +
			episodeLabel +
			") for " +
			properties.entityName
		);
	}
	if (signal.schema.slug === "media.episode.images.changed") {
		return "Episode image changed for " + episodeLabel + " in " + properties.entityName;
	}
	if (signal.schema.slug === "media.season-count.changed") {
		return (
			"Number of seasons changed from " +
			properties.oldCount +
			" to " +
			properties.newCount +
			" for " +
			properties.entityName
		);
	}
	if (signal.schema.slug === "media.episode.discovered") {
		const suffix =
			typeof properties.seasonNumber === "number"
				? " for Season " + properties.seasonNumber + " of " + properties.entityName
				: " for " + properties.entityName;
		return (
			properties.discoveredCount +
			" new episode" +
			(properties.discoveredCount === 1 ? "" : "s") +
			" discovered" +
			suffix
		);
	}
	if (
		[
			"person.media.associated",
			"company.media.associated",
			"person.media-group.associated",
			"company.media-group.associated",
		].includes(signal.schema.slug)
	) {
		return (
			properties.subjectName +
			" has been associated with " +
			properties.associatedName +
			" as " +
			properties.role
		);
	}
	throw new Error("Unsupported notification signal schema: " + signal.schema.slug);
}

driver("subscription", async function (context) {
	const signal =
		context.automation?.source?.kind === "signal" ? context.automation.source.signal : null;
	if (!signal) {
		return;
	}
	const result = await sendNotification({
		message: signalMessage(signal),
		effectKey: "notification:" + signal.id,
	});
	if (!result.success) {
		throw new Error(result.error);
	}
});
