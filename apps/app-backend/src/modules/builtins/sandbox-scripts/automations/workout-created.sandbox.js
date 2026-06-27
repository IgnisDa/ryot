driver("subscription", async function (context) {
	const automation = context.automation;
	const entity = automation?.source?.kind === "entity" ? automation.source.after : null;
	const signalSchemaId = context.rule?.metadata?.signalSchemaId;
	if (automation?.origin?.kind !== "api" || !entity || typeof signalSchemaId !== "string") {
		return;
	}

	const result = await emitSignal({
		signalSchemaId: signalSchemaId,
		effectKey: "workout-created:" + entity.id,
		properties: { workoutId: entity.id, workoutName: entity.name },
	});
	if (!result.success) {
		throw new Error(result.error);
	}
});
