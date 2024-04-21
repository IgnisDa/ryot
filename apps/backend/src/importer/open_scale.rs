use std::fs;

use async_graphql::Result;
use csv::Reader;
use itertools::Itertools;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::Deserialize;

use crate::importer::{
    DeployGenericCsvImportInput, ImportFailStep, ImportFailedItem, ImportResult,
};

#[derive(Debug, Deserialize)]
struct Record {
    biceps: Option<Decimal>,
    bone: Option<Decimal>,
    caliper1: Option<Decimal>,
    caliper2: Option<Decimal>,
    caliper3: Option<Decimal>,
    calories: Option<Decimal>,
    chest: Option<Decimal>,
    comment: Option<String>,
    #[serde(rename = "dateTime", with = "chrono::serde::ts_seconds_option")]
    date_time: Option<DateTimeUtc>,
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

pub async fn import(input: DeployGenericCsvImportInput) -> Result<ImportResult> {
    let mut measurements = vec![];
    let mut failed_items = vec![];
    let export = fs::read_to_string(&input.csv_path)?;
    let ratings_reader = Reader::from_reader(export.as_bytes())
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
        dbg!(&record);
    }
    Ok(ImportResult {
        measurements,
        failed_items,
        ..Default::default()
    })
}
