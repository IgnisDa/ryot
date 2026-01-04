driver("subscription", async function (context) {
	const automation = context.automation;
	const event = automation?.source?.kind === "event" ? automation.source.after : null;
	const signalSchemaId = context.rule?.metadata?.signalSchemaId;
	if (automation?.origin?.kind !== "api" || !event || typeof signalSchemaId !== "string") {
		return;
	}

	const result = await emitSignal({
		signalSchemaId: signalSchemaId,
		effectKey: "review-created:" + event.id,
		properties: {
			reviewEventId: event.id,
			entityId: event.entityId,
			entityName: event.entityName,
			entitySchemaSlug: event.entitySchemaSlug,
		},
	});
	if (!result.success) {
		throw new Error(result.error);
	}
});
