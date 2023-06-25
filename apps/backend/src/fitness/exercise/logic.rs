use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq)]
#[serde(tag = "t", content = "d")]
pub enum DoneSetStatistic {
    Duration(u16),
    DistanceAndDuration(u16, u16),
    RepsAndWeight(u16, u16),
}

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq)]
pub enum DoneSetPersonalBest {
    Weight,
    OneRm,
    Volume,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
pub struct DoneSetRecord {
    pub statistic: DoneSetStatistic,
    pub personal_bests: Vec<DoneSetPersonalBest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
pub struct DoneTotal {
    pub personal_bests: u16,
    pub weight: u32,
    pub reps: u32,
    pub active_duration: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
pub struct DoneExercise {
    pub idx: u16,
    pub exercise_id: i32,
    pub sets: Vec<DoneSetRecord>,
    pub notes: Vec<String>,
    pub rest_time: Option<u16>,
    pub total: DoneTotal,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
struct DoneWorkout {
    pub name: String,
    pub start_time: DateTimeUtc,
    pub end_time: DateTimeUtc,
    pub exercises: Vec<DoneExercise>,
    /// Each grouped superset of exercises will be in a vector
    pub supersets: Vec<Vec<u16>>,
    pub total: DoneTotal,
    pub user_id: i32,
}
