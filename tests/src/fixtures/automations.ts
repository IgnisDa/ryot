import { AutomationRuleId, SignalSchemaId } from "@ryot/contract/schema/brands";

import type { Client } from "./auth";

export function listAutomationCatalog(client: Client) {
	return client.run((c) => c.automations.listCatalog());
}

export function getAutomationCatalogSchema(client: Client, signalSchemaId: string) {
	return client.run((c) =>
		c.automations.getCatalog({ path: { signalSchemaId: SignalSchemaId.make(signalSchemaId) } }),
	);
}

export function listNotificationRules(client: Client) {
	return client.run((c) => c.automations.listRules());
}

export function getNotificationRule(client: Client, ruleId: string) {
	return client.run((c) =>
		c.automations.getRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }),
	);
}

export function installNotificationRule(client: Client, signalSchemaId: string) {
	return client.run((c) =>
		c.automations.installRule({ payload: { signalSchemaId: SignalSchemaId.make(signalSchemaId) } }),
	);
}

export function setNotificationRuleActive(client: Client, ruleId: string, isActive: boolean) {
	const path = { ruleId: AutomationRuleId.make(ruleId) };
	return client.run((c) =>
		isActive ? c.automations.activateRule({ path }) : c.automations.deactivateRule({ path }),
	);
}

export function deleteNotificationRule(client: Client, ruleId: string) {
	return client.run((c) =>
		c.automations.deleteRule({ path: { ruleId: AutomationRuleId.make(ruleId) } }),
	);
}
