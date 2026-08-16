import type { ServerOrigin } from "../../api/origin";

interface ConnectionOperations {
	saveServer(origin: ServerOrigin): void;
	checkHealth(origin: ServerOrigin): Promise<unknown>;
}

export async function verifyAndSaveServer(origin: ServerOrigin, operations: ConnectionOperations) {
	try {
		await operations.checkHealth(origin);
		operations.saveServer(origin);
		return true;
	} catch {
		return false;
	}
}
