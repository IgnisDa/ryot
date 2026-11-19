import { catalogMessage } from "../../shared/messages.generated";
import { exerciseTargetRoles } from "../../shared/taxonomy";
import { durationUnits } from "../../shared/workout-units";

export const fitnessRelationshipSchemas = () =>
	[
		{
			slug: "in-fitness-library",
			sourceEntitySchemaSlug: "exercise",
			targetEntitySchemaSlug: "fitness-library",
			name: catalogMessage("relationship-schema.in-fitness-library.name"),
			propertiesSchema: {
				fields: {
					dropRestTime: {
						type: "integer",
						validation: { minimum: 0 },
						label: catalogMessage("property.drop-set-rest"),
						description: "Drop set rest override in seconds; zero disables rest",
					},
					normalRestTime: {
						type: "integer",
						validation: { minimum: 0 },
						label: catalogMessage("property.normal-set-rest"),
						description: "Normal set rest override in seconds; zero disables rest",
					},
					warmUpRestTime: {
						type: "integer",
						validation: { minimum: 0 },
						label: catalogMessage("property.warm-up-set-rest"),
						description: "Warm-up set rest override in seconds; zero disables rest",
					},
					failureRestTime: {
						type: "integer",
						validation: { minimum: 0 },
						label: catalogMessage("property.failure-set-rest"),
						description: "Failure set rest override in seconds; zero disables rest",
					},
					defaultDurationUnit: {
						type: "enum",
						label: catalogMessage("property.duration-unit"),
						choices: { kind: "static", values: durationUnits.map((value) => ({ value })) },
						description: "Preferred set duration display unit; recorded durations stay in seconds",
					},
				},
			},
		},
		{
			propertiesSchema: { fields: {} },
			slug: "measurement-metric-pinned",
			targetEntitySchemaSlug: "fitness-library",
			sourceEntitySchemaSlug: "measurement-metric",
			name: catalogMessage("relationship-schema.measurement-metric-pinned.name"),
		},
		{
			slug: "exercise-targets",
			sourceEntitySchemaSlug: "exercise",
			targetEntitySchemaSlug: "exercise-target",
			name: catalogMessage("relationship-schema.exercise-targets.name"),
			propertiesSchema: {
				fields: {
					role: {
						type: "enum",
						label: catalogMessage("property.role"),
						description: "How this target is involved in the exercise",
						choices: { kind: "static", values: exerciseTargetRoles.map((value) => ({ value })) },
					},
				},
			},
		},
		{
			slug: "exercise-uses-equipment",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "exercise",
			targetEntitySchemaSlug: "exercise-equipment",
			name: catalogMessage("relationship-schema.exercise-uses-equipment.name"),
		},
		{
			slug: "workout-repeated-from",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "workout",
			targetEntitySchemaSlug: "workout",
			name: catalogMessage("relationship-schema.workout-repeated-from.name"),
		},
		{
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "workout",
			slug: "workout-to-workout-template",
			targetEntitySchemaSlug: "workout-template",
			name: catalogMessage("relationship-schema.workout-to-workout-template.name"),
		},
	] as const;
