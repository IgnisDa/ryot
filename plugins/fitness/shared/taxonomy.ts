import { Schema } from "@ryot-app/plugin-kit/effect";

export const exerciseTargetKinds = [
	"muscle",
	"muscle_region",
	"tendon",
	"fascia",
	"joint",
	"region",
] as const;

export const exerciseTargetKindSchema = Schema.Literals(exerciseTargetKinds);

export const exerciseTargetRoles = ["primary", "secondary", "stabilizer"] as const;
export const exerciseTargetRoleSchema = Schema.Literals(exerciseTargetRoles);

export const exerciseTargetCatalog = [
	{ name: "Lats", externalId: "lats", properties: { kind: "muscle_region" } },
	{ name: "Neck", externalId: "neck", properties: { kind: "muscle_region" } },
	{ name: "Traps", externalId: "traps", properties: { kind: "muscle_region" } },
	{ name: "Chest", externalId: "chest", properties: { kind: "muscle_region" } },
	{ name: "Biceps", externalId: "biceps", properties: { kind: "muscle_region" } },
	{ name: "Calves", externalId: "calves", properties: { kind: "muscle_region" } },
	{ name: "Glutes", externalId: "glutes", properties: { kind: "muscle_region" } },
	{ name: "Triceps", externalId: "triceps", properties: { kind: "muscle_region" } },
	{ name: "Forearms", externalId: "forearms", properties: { kind: "muscle_region" } },
	{ name: "Abductors", externalId: "abductors", properties: { kind: "muscle_region" } },
	{ name: "Adductors", externalId: "adductors", properties: { kind: "muscle_region" } },
	{ name: "Shoulders", externalId: "shoulders", properties: { kind: "muscle_region" } },
	{ name: "Lower Back", externalId: "lower_back", properties: { kind: "muscle_region" } },
	{ name: "Abdominals", externalId: "abdominals", properties: { kind: "muscle_region" } },
	{ name: "Hamstrings", externalId: "hamstrings", properties: { kind: "muscle_region" } },
	{ name: "Quadriceps", externalId: "quadriceps", properties: { kind: "muscle_region" } },
	{ name: "Middle Back", externalId: "middle_back", properties: { kind: "muscle_region" } },
] as const;

export const exerciseEquipmentCatalog = [
	{ name: "Bands", properties: {}, externalId: "bands" },
	{ name: "Cable", properties: {}, externalId: "cable" },
	{ name: "Other", properties: {}, externalId: "other" },
	{ properties: {}, name: "Barbell", externalId: "barbell" },
	{ properties: {}, name: "Machine", externalId: "machine" },
	{ properties: {}, name: "Body Only", externalId: "body_only" },
	{ properties: {}, name: "Dumbbell", externalId: "dumbbell" },
	{ properties: {}, name: "Foam Roll", externalId: "foam_roll" },
	{ properties: {}, name: "EZ Curl Bar", externalId: "ez_curl_bar" },
	{ properties: {}, name: "Kettlebells", externalId: "kettlebells" },
	{ properties: {}, name: "Exercise Ball", externalId: "exercise_ball" },
	{ properties: {}, name: "Medicine Ball", externalId: "medicine_ball" },
] as const;
