import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useRyot, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";

export const useAddToCollection = () => {
	const client = useRyot();
	const schedule = useRyotSchedule();
	return (entityId: string) =>
		schedule.run(client.screens.addToCollection({ entityId }).pipe(Effect.ignore), () => undefined);
};
