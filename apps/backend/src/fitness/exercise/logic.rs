use async_graphql::{Enum, InputObject, SimpleObject};
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    InputObject,
)]
#[graphql(input_name = "SetStatisticInput")]
pub struct SetStatistic {
    pub duration: Option<u16>,
    pub distance: Option<u16>,
    pub reps: Option<u16>,
    pub weigth: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, Enum, Copy)]
pub enum StatisticLot {
    Duration,
    DistanceAndDuration,
    Reps,
    RepsAndWeight,
}

#[derive(Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, Enum, Copy)]
pub enum SetPersonalBest {
    Weight,
    OneRm,
    Volume,
}

pub mod done {
    use super::*;

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct DoneSetRecord {
        pub statistic: SetStatistic,
        pub lot: StatisticLot,
        pub personal_bests: Vec<SetPersonalBest>,
    }

    #[derive(
        Debug, FromJsonQueryResult, Clone, Serialize, Deserialize, Eq, PartialEq, SimpleObject,
    )]
    pub struct DoneTotal {
        /// The number of personal bests achieved.
        pub personal_bests: u16,
        pub weight: u32,
        pub reps: u32,
        pub active_duration: u32,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct DoneExercise {
        pub idx: u16,
        pub exercise_id: i32,
        pub sets: Vec<DoneSetRecord>,
        pub notes: Vec<String>,
        pub rest_time: Option<u16>,
        pub total: DoneTotal,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    struct DoneWorkout {
        /// A unique identifier for this workout.
        pub identifier: String,
        pub name: Option<String>,
        pub start_time: DateTimeUtc,
        pub end_time: DateTimeUtc,
        pub exercises: Vec<DoneExercise>,
        /// Each grouped superset of exercises will be in a vector. They will contain
        /// the `exercise.idx`.
        pub supersets: Vec<Vec<u16>>,
        pub total: DoneTotal,
    }
}

pub mod in_progress {
    use super::*;

    #[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
    pub struct InProgressSetRecord {
        pub statistic: SetStatistic,
        pub lot: StatisticLot,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
    pub struct InProgressExercise {
        pub exercise_id: i32,
        pub sets: Vec<InProgressSetRecord>,
        pub notes: Vec<String>,
        pub rest_time: Option<u16>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize)]
    struct InProgressWorkout {
        pub exercises: Vec<InProgressExercise>,
        pub supersets: Vec<Vec<u16>>,
    }

    impl Default for InProgressWorkout {
        fn default() -> Self {
            Self {
                exercises: vec![],
                supersets: vec![],
            }
        }
    }
}
