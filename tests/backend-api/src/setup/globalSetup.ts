import {
	type StartedServices,
	startAllServices,
	stopAllServices,
} from "./testOrchestrator";

// Vitest requires the global setup to be an async function that optionally returns a teardown function.
// We store the started services in a closure to make them available to the teardown function.
let services: StartedServices | undefined;

export async function setup() {
	console.log("[GlobalSetup] Starting all services for tests...");
	try {
		services = await startAllServices();
		if (services.caddyBaseUrl) {
			process.env.API_BASE_URL = services.caddyBaseUrl;
			console.log(
				`[GlobalSetup] Services started. API_BASE_URL set to: ${services.caddyBaseUrl}`,
			);
		} else {
			throw new Error(
				"[GlobalSetup] Caddy base URL not available after starting services.",
			);
		}
	} catch (error) {
		console.error("[GlobalSetup] Failed to start services:", error);
		// Attempt to clean up any partially started services before throwing
		await teardown();
		throw error; // Re-throw to fail the test run
	}

	// Return the teardown function
	return teardown;
}

async function teardown(): Promise<void> {
	console.log("[GlobalTeardown] Tearing down all services...");
	if (services) {
		await stopAllServices(services);
		services = undefined; // Clear the services
	} else {
		console.log(
			"[GlobalTeardown] No services were recorded as started, nothing to stop explicitly.",
		);
	}
	console.log("[GlobalTeardown] Teardown complete.");
}
