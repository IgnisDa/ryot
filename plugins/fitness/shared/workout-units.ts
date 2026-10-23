import { Schema } from "@ryot-app/plugin-kit/effect";

export const KILOGRAMS_PER_POUND = 0.45359237;
export const KILOMETERS_PER_MILE = 1.609344;
export const KILOJOULES_PER_KILOCALORIE = 4.184;

export const unitSystems = ["metric", "imperial"] as const;
export const energyUnits = ["kcal", "kJ"] as const;
export const durationUnits = ["seconds", "minutes"] as const;

export const UnitSystemSchema = Schema.Literals(unitSystems);
export const EnergyUnitSchema = Schema.Literals(energyUnits);
export const DurationUnitSchema = Schema.Literals(durationUnits);
export type UnitSystem = typeof UnitSystemSchema.Type;
export type EnergyUnit = typeof EnergyUnitSchema.Type;
export type DurationUnit = typeof DurationUnitSchema.Type;

export const storageWorkoutDisplay = {
	weightUnit: "kg",
	distanceUnit: "km",
	durationUnit: "seconds",
} as const;

export const durationDisplayUnit = (
	...choices: ReadonlyArray<DurationUnit | null | undefined>
): DurationUnit => choices.find((choice) => choice !== null && choice !== undefined) ?? "minutes";

export const milesToKilometers = (miles: number) => miles * KILOMETERS_PER_MILE;
export const poundsToKilograms = (pounds: number) => pounds * KILOGRAMS_PER_POUND;
export const kilogramsToPounds = (kilograms: number) => kilograms / KILOGRAMS_PER_POUND;
export const kilometersToMiles = (kilometers: number) => kilometers / KILOMETERS_PER_MILE;

export const kilocaloriesToEnergy = (kilocalories: number, unit: EnergyUnit) =>
	unit === "kJ" ? kilocalories * KILOJOULES_PER_KILOCALORIE : kilocalories;
export const energyToKilocalories = (energy: number, unit: EnergyUnit) =>
	unit === "kJ" ? energy / KILOJOULES_PER_KILOCALORIE : energy;
