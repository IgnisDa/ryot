import type { ServerOrigin } from "../../api/origin";
import { clearServerSelection, type BrowserStorage } from "../../persistence/storage";
import { clearAuthStorage, getAuthClient } from "./client";

export type ServerChangeOperations = {
	readonly signOut: () => Promise<unknown>;
	readonly clearAuth: () => void;
	readonly clearServer: () => void;
};

export async function changeServer(operations: ServerChangeOperations) {
	try {
		await operations.signOut();
	} catch {
		// Local cleanup must complete when the old server is unavailable.
	} finally {
		operations.clearAuth();
		operations.clearServer();
	}
}

export const changeSelectedServer = (origin: ServerOrigin | null, storage?: BrowserStorage) =>
	changeServer({
		clearAuth: () => clearAuthStorage(storage),
		clearServer: () => clearServerSelection(storage),
		signOut: () => (origin === null ? Promise.resolve() : getAuthClient(origin).signOut()),
	});
