use std::fs;

use async_graphql::Result;
use csv::Reader;
use database::{MediaLot, MediaSource};
use itertools::Itertools;
use serde::Deserialize;

use crate::{
    importer::{DeployImdbImportInput, ImportFailStep, ImportFailedItem, ImportResult},
    miscellaneous::DefaultCollection,
    models::media::{ImportOrExportItemIdentifier, ImportOrExportMediaItem},
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
    let total = ratings_reader.len();
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
        let lot = match record.title_type.as_str() {
            "Movie" | "Video" => MediaLot::Movie,
            "TV Series" | "TV Mini Series" => MediaLot::Show,
            tt => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: record.id.clone(),
                    error: Some(format!("Unknown title type: {tt}")),
                });
                continue;
            }
        };
        let tmdb_identifier = match tmdb_service
            .find_by_external_id(&record.id, "imdb_id")
            .await
        {
            Ok(i) => i,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::MediaDetailsFromProvider,
                    identifier: record.id.clone(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        tracing::debug!("Found tmdb id: {} ({}/{})", tmdb_identifier, idx + 1, total);
        media.push(ImportOrExportMediaItem {
            collections: vec![DefaultCollection::Watchlist.to_string()],
            identifier: "".to_string(),
            internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails {
                identifier: tmdb_identifier,
                title: record.title,
            }),
            lot,
            source,
            source_id: record.id,
            reviews: vec![],
            seen_history: vec![],
        });
    }
    Ok(ImportResult {
        media,
        failed_items,
        ..Default::default()
    })
}
