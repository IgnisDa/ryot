export const KILOGRAMS_PER_POUND = 0.45359237;
export const KILOMETERS_PER_MILE = 1.609344;

export const milesToKilometers = (miles: number) => miles * KILOMETERS_PER_MILE;
export const poundsToKilograms = (pounds: number) => pounds * KILOGRAMS_PER_POUND;
export const kilogramsToPounds = (kilograms: number) => kilograms / KILOGRAMS_PER_POUND;
export const kilometersToMiles = (kilometers: number) => kilometers / KILOMETERS_PER_MILE;
