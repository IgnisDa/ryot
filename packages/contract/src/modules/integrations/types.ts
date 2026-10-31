export const integrationLots = ["yank", "sink", "push"] as const;

export type IntegrationLot = (typeof integrationLots)[number];
