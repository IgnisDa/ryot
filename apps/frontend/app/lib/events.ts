import { EntityLot } from "@ryot/generated/graphql/backend/graphql";

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
};
