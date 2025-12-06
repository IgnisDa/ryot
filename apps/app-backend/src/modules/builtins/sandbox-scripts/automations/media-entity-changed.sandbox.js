const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isString = (value) => typeof value === "string";
const isSpecialSeason = (season) => ["Special", "Specials"].includes(season?.name);

function canonicalJson(value) {
	if (Array.isArray(value)) {
		return (
			"[" +
			value
				.map(canonicalJson)
				.sort((left, right) => left.localeCompare(right))
				.join(",") +
			"]"
		);
	}
	if (value && typeof value === "object") {
		return (
			"{" +
			Object.keys(value)
				.sort()
				.map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
				.join(",") +
			"}"
		);
	}
	return JSON.stringify(value);
}

function sameImageSet(before, after) {
	const beforeSet = new Set((Array.isArray(before) ? before : []).map(canonicalJson));
	const afterSet = new Set((Array.isArray(after) ? after : []).map(canonicalJson));
	return beforeSet.size === afterSet.size && [...beforeSet].every((image) => afterSet.has(image));
}

async function emit(signalSchemaId, effectKey, subjectEntityId, properties) {
	const result = await emitSignal({ signalSchemaId, effectKey, subjectEntityId, properties });
	if (!result.success) {
		throw new Error(result.error);
	}
}

driver("subscription", async function (context) {
	const automation = context.automation;
	const before = automation?.source?.kind === "entity" ? automation.source.before : null;
	const after = automation?.source?.kind === "entity" ? automation.source.after : null;
	const scope = automation?.scopeEntity;
	const signals = context.rule?.metadata?.signals;
	if (
		automation?.operation !== "update" ||
		automation.rootPreviouslyPopulated !== true ||
		!before ||
		!after ||
		!scope ||
		!signals
	) {
		return;
	}

	const entityName = scope.name;
	const subjectEntityId = scope.id;
	const slug = after.entitySchemaSlug;
	const afterProperties = after.properties ?? {};
	const beforeProperties = before.properties ?? {};
	const beforeStatus = beforeProperties.productionStatus;
	const afterStatus = afterProperties.productionStatus;
	if (isString(beforeStatus) && isString(afterStatus) && beforeStatus !== afterStatus) {
		await emit(signals.status, "status", subjectEntityId, {
			entityName,
			oldStatus: beforeStatus,
			newStatus: afterStatus,
		});
	}

	const beforeYear = beforeProperties.publishYear;
	const afterYear = afterProperties.publishYear;
	if (isNumber(beforeYear) && isNumber(afterYear) && beforeYear !== afterYear) {
		await emit(signals.releaseDate, "publish-year", subjectEntityId, {
			entityName,
			newYear: afterYear,
			oldYear: beforeYear,
			changeKind: "publish_year",
		});
	}

	let countProperty = null;
	if (slug === "anime") {
		countProperty = "episodes";
	} else if (slug === "manga") {
		countProperty = "chapters";
	}
	if (countProperty) {
		const oldCount = beforeProperties[countProperty];
		const newCount = afterProperties[countProperty];
		if (isNumber(oldCount) && isNumber(newCount) && oldCount !== newCount) {
			await emit(signals.contentCount, "content-count", subjectEntityId, {
				oldCount,
				newCount,
				entityName,
				contentType: countProperty,
			});
		}
	}

	if (
		!["show-episode", "podcast-episode"].includes(slug) ||
		isSpecialSeason(automation.owningSeason)
	) {
		return;
	}
	const episodeNumber = beforeProperties.episodeNumber ?? afterProperties.episodeNumber;
	if (!isNumber(episodeNumber)) {
		return;
	}
	const seasonNumber = automation.owningSeason?.number;
	const episodeContext = {
		entityName,
		episodeNumber,
		...(isNumber(seasonNumber) ? { seasonNumber } : {}),
	};
	const oldName = before.name ?? null;
	const newName = after.name ?? null;
	if (oldName !== newName) {
		await emit(signals.episodeName, "episode-name", subjectEntityId, {
			...episodeContext,
			oldName,
			newName,
		});
	}
	if (!sameImageSet(beforeProperties.images, afterProperties.images)) {
		await emit(signals.episodeImages, "episode-images", subjectEntityId, episodeContext);
	}
	const oldDate = beforeProperties.publishDate;
	const newDate = afterProperties.publishDate;
	if (slug === "show-episode" && isString(oldDate) && isString(newDate) && oldDate !== newDate) {
		await emit(signals.releaseDate, "episode-date", subjectEntityId, {
			...episodeContext,
			oldDate,
			newDate,
			changeKind: "episode_date",
		});
	}
});
