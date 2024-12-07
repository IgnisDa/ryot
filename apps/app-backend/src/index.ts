import "dotenv/config";
import { startServer } from "~/app/runtime";

export type { AppType } from "~/app/api";

startServer().catch((err) => {
	console.error("Error starting server:", err);
	process.exit(1);
});
