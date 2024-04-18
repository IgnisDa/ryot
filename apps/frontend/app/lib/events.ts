import type Umami from "@bitprojects/umami-logger-typescript";
import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";

declare global {
	interface Window {
		umami?: {
			track: typeof Umami.trackEvent;
		};
	}
}

export default {
	updateProgress: (title: string) => {
		window.umami?.track("Update Progress", { title });
	},
	postReview: (title: string) => {
		window.umami?.track("Post Review", { title });
	},
	deployImport: (source: string) => {
		window.umami?.track("Deploy Import", { source });
	},
	createWorkout: () => {
		window.umami?.track("Create Workout", {});
	},
	createMeasurement: () => {
		window.umami?.track("Create Measurement", {});
	},
	addToCollection: (entityLot: EntityLot) => {
		window.umami?.track("Add To Collection", { entityLot });
	},
	markAsOwned: () => {
		window.umami?.track("Mark As Owned", {});
	}
};
