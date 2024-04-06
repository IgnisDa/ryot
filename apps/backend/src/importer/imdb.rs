use std::fs;

use async_graphql::Result;
use csv::Reader;
use database::{MediaLot, MediaSource};
use itertools::Itertools;
use serde::Deserialize;

use crate::{
    importer::{DeployImdbImportInput, ImportFailStep, ImportFailedItem, ImportResult},
    providers::tmdb::NonMediaTmdbService,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Item {
    #[serde(rename = "Const")]
    id: String,
    title: String,
    #[serde(rename = "Title Type")]
    title_type: String,
}

pub async fn import(
    input: DeployImdbImportInput,
    tmdb_service: &NonMediaTmdbService,
) -> Result<ImportResult> {
    let source = MediaSource::Tmdb;
    let mut media = vec![];
    let mut failed_items = vec![];
    let export = fs::read_to_string(input.csv_path)?;
    let ratings_reader = Reader::from_reader(export.as_bytes())
        .deserialize()
        .collect_vec();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Item = match result {
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
        media,
        failed_items,
        ..Default::default()
    })
}
