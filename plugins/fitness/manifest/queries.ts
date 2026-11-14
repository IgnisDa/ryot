import {
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessAnalyticsWorkoutsRecipe,
	historicalFitnessRankingRecipe,
} from "../shared/analytics-recipes";
import { exerciseDetailsRecipe } from "../shared/exercise-details-recipes";
import { recentPersonalBestsRecipe } from "../shared/home-recipes";
import { measurementSeriesRecipe, measurementSummaryRecipe } from "../shared/measurement-recipes";
import { workoutDetailRecipe } from "../shared/query-recipes";

const reference = { kind: "self" } as const;
const personalBests = recentPersonalBestsRecipe({ reference }).document.queries.recent;
if (personalBests?.output.type !== "rows") {
	throw new Error("Personal bests recipe must declare a recent rows query");
}
export const fitnessDeclaredQueries = {
	"workout-detail": {
		title: "Read workout",
		document: workoutDetailRecipe({ reference }).document,
		description:
			"Read one workout by entityId, including its recorded start and end times, notes, energy, and linked workout template.",
	},
	workouts: {
		title: "List workouts",
		document: fitnessAnalyticsWorkoutsRecipe({ reference }).document,
		description:
			"Read workouts in a reporting period, newest first. Optionally restrict the workouts to a recorded exercise, muscle, or equipment item. Page workouts for older results.",
	},
	"exercise-history": {
		title: "Read exercise history",
		document: exerciseDetailsRecipe({ reference }).document,
		description:
			"Read one exercise by exerciseId, including its recorded workout history, personal bests, notes, lifetime totals, and monthly activity in the account's reporting time zone.",
	},
	"analytics-trend": {
		title: "Read workout trend",
		document: fitnessAnalyticsTrendRecipe({ reference }).document,
		description:
			"Group one workout or set metric by reporting calendar day, week, month, or year. Choose a metric and reporting period, with an optional recorded exercise, muscle, or equipment filter.",
	},
	"analytics-totals": {
		title: "Summarize fitness totals",
		document: fitnessAnalyticsTotalsRecipe({ reference }).document,
		description:
			"Summarize workouts, sets, volume, repetitions, active time, energy, personal bests, and measurement activity in the selected or preceding comparison period. Missing measurements and processing state remain explicit.",
	},
	"analytics-ranking": {
		title: "Rank muscles, equipment or exercises",
		document: historicalFitnessRankingRecipe({ reference }).document,
		description:
			"Rank recorded muscles, equipment, or exercises by weighted set counts in a reporting period. Muscles retain primary and secondary weighting. Page the query named by kind: targets, equipment, or exercises.",
	},
	"measurement-metrics": {
		title: "List measurement metrics",
		document: measurementSummaryRecipe({ reference }).document,
		description:
			"List the account's measurement metrics, such as body weight, with their IDs, keys, units, latest values and reading counts in a reporting period. Use these IDs with measurement-series and the measurement reading operations.",
	},
	"measurement-series": {
		title: "Read measurement series",
		document: measurementSeriesRecipe({ reference }).document,
		description:
			"Read bucket averages for up to two measurement metrics selected by metricIds over a reporting period. Submit additional selected metrics in separate requests. All-time series choose a bounded grouping from the first recorded reading.",
	},
	"personal-bests": {
		title: "Read recent personal bests",
		description:
			"Read the most recent recorded sets awarded personal bests, including exercise names and recorded measurements. Set pages.recent.limit to choose how many results to return.",
		document: {
			parameters: { fields: {} },
			queries: {
				recent: {
					...personalBests,
					output: { ...personalBests.output, pagination: { limit: 5, maxLimit: 100 } },
				},
			},
		},
	},
};
