use async_graphql::Result;
use common_models::DefaultCollection;
use common_utils::ryot_log;
use csv::Reader;
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{DeployGenericCsvImportInput, ImportOrExportMetadataItem};
pub use providers::tmdb::NonMediaTmdbService;
use serde::Deserialize;

use super::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Item {
    #[serde(rename = "Const")]
    id: String,
    #[serde(rename = "Title Type")]
    title_type: String,
}

pub async fn import(
    input: DeployGenericCsvImportInput,
    tmdb_service: &NonMediaTmdbService,
) -> Result<ImportResult> {
    let source = MediaSource::Tmdb;
    let mut completed = vec![];
    let mut failed = vec![];
    let ratings_reader = Reader::from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Item = match result {
            Ok(r) => r,
            Err(e) => {
                failed.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let lot = match record.title_type.as_str() {
            "Movie" | "Video" | "movie" | "video" => MediaLot::Movie,
            "TV Series" | "TV Mini Series" | "tvSeries" | "tvMiniSeries" => MediaLot::Show,
            tt => {
                failed.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: record.id.clone(),
                    error: Some(format!("Unknown title type: {tt}")),
                });
                continue;
            }
        };
        let identifier = match tmdb_service
            .find_by_external_id(&record.id, "imdb_id")
            .await
        {
            Ok(i) => i,
            Err(e) => {
                failed.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::MediaDetailsFromProvider,
                    identifier: record.id.clone(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        ryot_log!(
            debug,
            "Found tmdb id: {} ({}/{})",
            identifier,
            idx + 1,
            total
        );
        completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source,
            identifier,
            source_id: record.id,
            collections: vec![DefaultCollection::Watchlist.to_string()],
            ..Default::default()
        }));
    }
    Ok(ImportResult {
        failed,
        completed,
        ..Default::default()
    })
}
