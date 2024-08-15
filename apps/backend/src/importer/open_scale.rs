use std::sync::Arc;

use async_graphql::Result;
use chrono::NaiveDateTime;
use csv::ReaderBuilder;
use itertools::Itertools;
use models::{user_measurement, DeployGenericCsvImportInput, UserMeasurementStats};
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::importer::{app_utils, ImportFailStep, ImportFailedItem, ImportResult};

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
    timezone: Arc<chrono_tz::Tz>,
) -> Result<ImportResult> {
    let mut measurements = vec![];
    let mut failed_items = vec![];
    let ratings_reader = ReaderBuilder::new()
        .from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Record = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let ndt = NaiveDateTime::parse_from_str(&record.date_time, "%Y-%m-%d %H:%M")
            .expect("Failed to parse input string");
        let timestamp = app_utils::get_date_time_with_offset(ndt, timezone.clone());
        measurements.push(user_measurement::Model {
            timestamp,
            user_id: "".to_string(),
            name: None,
            comment: record.comment,
            stats: UserMeasurementStats {
                weight: record.weight,
                biceps_circumference: record.biceps,
                bone_mass: record.bone,
                chest_skinfold: record.caliper1,
                abdominal_skinfold: record.caliper2,
                thigh_skinfold: record.caliper3,
                calories: record.calories,
                chest_circumference: record.chest,
                body_fat: record.fat,
                hip_circumference: record.hip,
                lean_body_mass: record.lbm,
                muscle: record.muscle,
                neck_circumference: record.neck,
                thigh_circumference: record.thigh,
                visceral_fat: record.visceral_fat,
                waist_circumference: record.waist,
                total_body_water: record.water,
                ..Default::default()
            },
        });
    }
    Ok(ImportResult {
        measurements,
        failed_items,
        ..Default::default()
    })
}
