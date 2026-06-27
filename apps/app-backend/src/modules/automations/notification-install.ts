import { SandboxScriptId, SignalSchemaId, UserId } from "@ryot/contract/schema/brands";

export const NOTIFICATION_SCRIPT_SLUG = "automation.send-signal-notification";

export const buildNotificationRuleValues = (input: {
	userId: string;
	signalSchemaId: string;
	sandboxScriptId: string;
	signalSchemaName: string;
}) => ({
	metadata: {},
	position: 1000,
	isActive: true,
	isBuiltin: true,
	operation: "signal" as const,
	kind: "subscription" as const,
	userId: UserId.make(input.userId),
	name: `${input.signalSchemaName} Notification`,
	signalSchemaId: SignalSchemaId.make(input.signalSchemaId),
	sandboxScriptId: SandboxScriptId.make(input.sandboxScriptId),
});
