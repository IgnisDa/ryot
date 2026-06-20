const asRoles = (properties) =>
	Array.isArray(properties?.roles)
		? [...new Set(properties.roles.filter((role) => typeof role === "string"))]
		: [];

async function emit(signalSchemaId, effectKey, subjectEntityId, properties) {
	const result = await emitSignal({ signalSchemaId, effectKey, subjectEntityId, properties });
	if (!result.success) {
		throw new Error(result.error);
	}
}

driver("subscription", async function (context) {
	const automation = context.automation;
	const source = automation?.source?.kind === "relationship" ? automation.source : null;
	const after = source?.after;
	const before = source?.before;
	const metadata = context.rule?.metadata;
	if (!source || !metadata) {
		return;
	}

	if (metadata.detector === "season-count") {
		const batch = automation.batch;
		if (
			automation.rootPreviouslyPopulated !== true ||
			!batch?.isLeader ||
			batch.beforeCount === batch.afterCount ||
			!automation.scopeEntity
		) {
			return;
		}
		await emit(metadata.signalSchemaId, "season-count", automation.scopeEntity.id, {
			entityName: automation.scopeEntity.name,
			oldCount: batch.beforeCount,
			newCount: batch.afterCount,
		});
		return;
	}

	if (metadata.detector === "episode-discovery") {
		const batch = automation.batch;
		if (
			automation.rootPreviouslyPopulated !== true ||
			!batch?.isLeader ||
			batch.createdCount === 0 ||
			!automation.scopeEntity ||
			["Special", "Specials"].includes(automation.owningSeason?.name)
		) {
			return;
		}
		await emit(metadata.signalSchemaId, "episode-discovery", automation.scopeEntity.id, {
			oldCount: batch.beforeCount,
			newCount: batch.afterCount,
			discoveredCount: batch.createdCount,
			entityName: automation.scopeEntity.name,
			...(typeof automation.owningSeason?.number === "number"
				? { seasonNumber: automation.owningSeason.number }
				: {}),
		});
		return;
	}

	if (metadata.detector !== "association" || !after || automation.operation === "delete") {
		return;
	}
	const subject = after.source;
	if (automation.rootPreviouslyPopulated === false && automation.scopeEntity?.id === subject.id) {
		return;
	}
	const previousRoles = new Set(asRoles(before?.properties));
	const roles = asRoles(after.properties).filter((role) => !previousRoles.has(role));
	for (const role of roles) {
		await emit(metadata.signalSchemaId, "association:" + role, subject.id, {
			role,
			subjectName: subject.name,
			associatedName: after.target.name,
		});
	}
});
