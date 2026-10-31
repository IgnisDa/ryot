# Fitness

The Fitness plugin defines exercise tracking, workout plans and history, and personal measurements. Kernel concepts retain the meanings in the [kernel glossary](../../GLOSSARY.md).

## Language

### Exercises

**Exercise**:
A reusable description of a physical activity and the measurements used to record its sets. It is distinct from an occurrence of that exercise in a workout.

**Exercise kind**:
The fixed combination of repetitions, weight, duration, and distance used to measure an exercise's sets.
_Avoid_: Set type, exercise target

**Exercise target**:
An anatomical subject involved in an exercise, such as a muscle, muscle region, tendon, fascia, joint, or region.
_Avoid_: Muscle as a synonym for every target

**Target role**:
The involvement of a target in a particular exercise: primary, secondary, or stabilizer.

**Exercise equipment**:
A reusable description of equipment used by an exercise, linked separately from its anatomical targets.

**Fitness library**:
A user's selected exercises, with personal exercise preferences distinct from the shared exercise description.

**Exercise override**:
A personal rest or duration-display choice attached to an exercise's Fitness library membership, overriding an inherited preference without changing the shared exercise.

**Exercise note**:
A private review or rating of an exercise, distinct from notes about one workout occurrence or set.

### Workouts And Plans

**Workout**:
A user's recorded exercise session with start time and any known end time or active duration. It groups performed sets through their session association.
_Avoid_: Workout template, workout draft

**Exercise occurrence**:
One placement of an exercise within a workout or template, with its own order, sets, notes, and attachments. The same exercise can occur more than once.
_Avoid_: Exercise entity

**Workout set**:
A recorded performance of an exercise within a workout, measured according to the exercise kind. It is a fact about the exercise grouped under the workout, not a separate exercise entity.
_Avoid_: Planned set

**Set type**:
The training purpose of a set: normal, warm-up, drop, or failure, independent of the exercise's measurement kind.
_Avoid_: Exercise kind

**Workout template**:
A reusable plan of ordered exercise occurrences and planned sets, without recorded execution events.
_Avoid_: Workout history

**Planned set**:
A set's intended measurements and rest in a workout template, not evidence that the set was performed.
_Avoid_: Workout set

**Workout draft**:
Uncommitted editor state for a live workout, historical edit, or template edit, including any local timers and unconfirmed sets. Measurements saved separately are not part of that uncommitted state.
_Avoid_: Saved workout

**Superset**:
A grouping of exercise occurrences within a workout or template for combined training progression.

**Active duration**:
Recorded workout time including ordinary rest but excluding explicit pauses. An unknown duration is distinct from zero.
_Avoid_: Elapsed duration

**Elapsed duration**:
Time between a workout's start and end, without subtracting explicit pauses.
_Avoid_: Active duration

**Personal best**:
A derived performance achievement for an exercise, calculated from recorded sets rather than entered as a source fact.

### Measurements

**Measurement metric**:
A user-owned named quantity with a stable key and optional unit, such as body weight, whose readings are recorded over time.
_Avoid_: Measurement reading

**Measurement entry**:
One logged or imported submission, holding its occurrence time and optional comment. Its readings belong to it by reference; equal timestamps never merge entries.
_Avoid_: Measurement reading

**Measurement reading**:
A user's value for a measurement metric within a measurement entry. Readings saved during a live workout remain independent of whether that workout is saved.
_Avoid_: Measurement metric, workout set, measurement entry

**Pinned metric**:
A measurement metric selected for prominent display and logging in the user's Fitness library.
