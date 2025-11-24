use anyhow::Result;
use chrono::NaiveDateTime;
use csv::ReaderBuilder;
use database_models::user_measurement;
use dependent_import_utils::get_date_time_with_offset;
use dependent_models::{ImportCompletedItem, ImportResult};
use fitness_models::{UserMeasurementInformation, UserMeasurementStatistic};
use itertools::Itertools;
use media_models::DeployGenericCsvImportInput;
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
struct Record {
    #[serde(rename = "dateTime")]
    date_time: String,
    biceps: Option<Decimal>,
    bone: Option<Decimal>,
    caliper1: Option<Decimal>,
    caliper2: Option<Decimal>,
    caliper3: Option<Decimal>,
    calories: Option<Decimal>,
    chest: Option<Decimal>,
    comment: Option<String>,
    fat: Option<Decimal>,
    hip: Option<Decimal>,
    lbm: Option<Decimal>,
    muscle: Option<Decimal>,
    neck: Option<Decimal>,
    thigh: Option<Decimal>,
    #[serde(rename = "visceralFat")]
    visceral_fat: Option<Decimal>,
    waist: Option<Decimal>,
    water: Option<Decimal>,
    weight: Option<Decimal>,
}

pub async fn import(
    input: DeployGenericCsvImportInput,
    timezone: &chrono_tz::Tz,
) -> Result<ImportResult> {
    let mut completed = vec![];
    let mut failed = vec![];
    let ratings_reader = ReaderBuilder::new()
        .from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Record = match result {
            Ok(r) => r,
            Err(e) => {
                failed.push(ImportFailedItem {
                    error: Some(e.to_string()),
                    identifier: idx.to_string(),
                    step: ImportFailStep::InputTransformation,
                    ..Default::default()
                });
                continue;
            }
        };
        let ndt = NaiveDateTime::parse_from_str(&record.date_time, "%Y-%m-%d %H:%M")
            .expect("Failed to parse input string");
        let timestamp = get_date_time_with_offset(ndt, timezone);
        let mut information = UserMeasurementInformation::default();
        if let Some(weight) = record.weight {
            information.statistics.push(UserMeasurementStatistic {
                name: "weight".to_string(),
                value: weight,
            });
        }
        if let Some(biceps) = record.biceps {
            information.statistics.push(UserMeasurementStatistic {
                name: "biceps_circumference".to_string(),
                value: biceps,
            });
        }
        if let Some(bone) = record.bone {
            information.statistics.push(UserMeasurementStatistic {
                name: "bone_mass".to_string(),
                value: bone,
            });
        }
        if let Some(caliper1) = record.caliper1 {
            information.statistics.push(UserMeasurementStatistic {
                name: "chest_skinfold".to_string(),
                value: caliper1,
            });
        }
        if let Some(caliper2) = record.caliper2 {
            information.statistics.push(UserMeasurementStatistic {
                name: "abdominal_skinfold".to_string(),
                value: caliper2,
            });
        }
        if let Some(caliper3) = record.caliper3 {
            information.statistics.push(UserMeasurementStatistic {
                name: "thigh_skinfold".to_string(),
                value: caliper3,
            });
        }
        if let Some(calories) = record.calories {
            information.statistics.push(UserMeasurementStatistic {
                name: "calories".to_string(),
                value: calories,
            });
        }
        if let Some(chest) = record.chest {
            information.statistics.push(UserMeasurementStatistic {
                name: "chest_circumference".to_string(),
                value: chest,
            });
        }
        if let Some(fat) = record.fat {
            information.statistics.push(UserMeasurementStatistic {
                name: "body_fat".to_string(),
                value: fat,
            });
        }
        if let Some(hip) = record.hip {
            information.statistics.push(UserMeasurementStatistic {
                name: "hip_circumference".to_string(),
                value: hip,
            });
        }
        if let Some(lbm) = record.lbm {
            information.statistics.push(UserMeasurementStatistic {
                name: "lean_body_mass".to_string(),
                value: lbm,
            });
        }
        if let Some(muscle) = record.muscle {
            information.statistics.push(UserMeasurementStatistic {
                name: "muscle".to_string(),
                value: muscle,
            });
        }
        if let Some(neck) = record.neck {
            information.statistics.push(UserMeasurementStatistic {
                name: "neck_circumference".to_string(),
                value: neck,
            });
        }
        if let Some(thigh) = record.thigh {
            information.statistics.push(UserMeasurementStatistic {
                name: "thigh_circumference".to_string(),
                value: thigh,
            });
        }
        if let Some(visceral_fat) = record.visceral_fat {
            information.statistics.push(UserMeasurementStatistic {
                name: "visceral_fat".to_string(),
                value: visceral_fat,
            });
        }
        if let Some(waist) = record.waist {
            information.statistics.push(UserMeasurementStatistic {
                name: "waist_circumference".to_string(),
                value: waist,
            });
        }
        if let Some(water) = record.water {
            information.statistics.push(UserMeasurementStatistic {
                name: "total_body_water".to_string(),
                value: water,
            });
        }

        completed.push(ImportCompletedItem::Measurement(user_measurement::Model {
            timestamp,
            information,
            comment: record.comment,
            ..Default::default()
        }));
    }
    Ok(ImportResult { failed, completed })
}
