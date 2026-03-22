import type { ContractSuccess } from "@ryot/contract/client";

export type GodModeUser = ContractSuccess<"godMode", "listUsers">["users"][number];

// TODO: Replace with godMode.listUsers once the admin API is wired up.
export const sampleGodModeUsers: readonly GodModeUser[] = [
	{
		id: "usr_ada",
		disabledAt: null,
		name: "Ada Lovelace",
		twoFactorEnabled: true,
		authState: "credential",
		email: "ada@example.com",
		createdAt: "2025-01-12T09:24:00.000Z",
	},
	{
		id: "usr_grace",
		authState: "oidc",
		disabledAt: null,
		name: "Grace Hopper",
		twoFactorEnabled: null,
		email: "grace@example.com",
		createdAt: "2025-02-03T14:05:00.000Z",
	},
	{
		id: "usr_alan",
		disabledAt: null,
		authState: "mixed",
		name: "Alan Turing",
		twoFactorEnabled: false,
		email: "alan@example.com",
		createdAt: "2025-03-21T08:47:00.000Z",
	},
	{
		id: "usr_katherine",
		authState: "none",
		disabledAt: null,
		twoFactorEnabled: null,
		name: "Katherine Johnson",
		email: "katherine@example.com",
		createdAt: "2025-04-09T17:31:00.000Z",
	},
	{
		id: "usr_edsger",
		twoFactorEnabled: false,
		name: "Edsger Dijkstra",
		authState: "credential",
		email: "edsger@example.com",
		createdAt: "2024-11-27T11:12:00.000Z",
		disabledAt: "2025-06-18T10:02:00.000Z",
	},
];
