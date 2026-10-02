use anyhow::Result;
use chrono::NaiveDate;
use common_models::DefaultCollection;
use common_utils::{convert_naive_to_utc, ryot_log};
use csv::Reader;
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use enum_models::{ImportSource, MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    DeployGenericCsvImportInput, ImportOrExportItemRating, ImportOrExportMetadataItemSeen,
};
use rust_decimal::{dec, Decimal};
use serde::Deserialize;
use tmdb_provider::NonMediaTmdbService;

use importer_models::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Item {
    #[serde(rename = "Const")]
    id: String,
    #[serde(rename = "Title Type")]
    title_type: String,
    #[serde(default, rename = "Your Rating")]
    your_rating: Option<Decimal>,
    #[serde(default, rename = "Date Rated")]
    date_rated: Option<String>,
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
                    error: Some(e.to_string()),
                    identifier: idx.to_string(),
                    step: ImportFailStep::InputTransformation,
                    ..Default::default()
                });
                continue;
            }
        };
        let lot = match record.title_type.as_str() {
            "Movie" | "Video" | "movie" | "video" => MediaLot::Movie,
            "TV Series" | "TV Mini Series" | "tvSeries" | "tvMiniSeries" => MediaLot::Show,
            tt => {
                failed.push(ImportFailedItem {
                    identifier: record.id.clone(),
                    step: ImportFailStep::InputTransformation,
                    error: Some(format!("Unknown title type: {tt}")),
                    ..Default::default()
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
                    identifier: record.id.clone(),
                    step: ImportFailStep::ItemDetailsFromSource,
                    error: Some(format!("Could not fetch details from TMDB: {e}")),
                });
                continue;
            }
        };
        ryot_log!(debug, "Tmdb id: {} ({}/{})", identifier, idx + 1, total);
        let ended_on = record.date_rated.as_deref().and_then(|d| {
            NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .or_else(|_| NaiveDate::parse_from_str(d, "%Y/%m/%d"))
                .ok()
                .map(convert_naive_to_utc)
        });
        let is_watched = record.your_rating.is_some() || record.date_rated.is_some();
        let (collections, seen_history) = if is_watched {
            let seen_item = ImportOrExportMetadataItemSeen {
                ended_on,
                providers_consumed_on: Some(vec![ImportSource::Imdb.to_string()]),
                ..Default::default()
            };
            (vec![], vec![seen_item])
        } else {
            (
                vec![CollectionToEntityDetails {
                    collection_name: DefaultCollection::Watchlist.to_string(),
                    ..Default::default()
                }],
                vec![],
            )
        };
        let reviews = match record.your_rating {
            Some(r) if r > dec!(0) => vec![ImportOrExportItemRating {
                // DEV: Rates items out of 10
                rating: Some(r.saturating_mul(dec!(10))),
                ..Default::default()
            }],
            _ => vec![],
        };
        completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source,
            identifier,
            source_id: record.id,
            collections,
            seen_history,
            reviews,
        }));
    }
    Ok(ImportResult { failed, completed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_ratings_csv() {
        let csv = "Const,Your Rating,Date Rated,Title Type\ntt0111161,9,2023-08-15,movie\n";
        let mut reader = Reader::from_reader(csv.as_bytes());
        let item: Item = reader.deserialize().next().unwrap().unwrap();
        assert_eq!(item.id, "tt0111161");
        assert_eq!(item.title_type, "movie");
        assert_eq!(item.your_rating, Some(dec!(9)));
        assert_eq!(item.date_rated, Some("2023-08-15".to_string()));
    }

    #[test]
    fn test_deserialize_watchlist_csv_without_rating_columns() {
        let csv = "Const,Title Type\ntt0111161,movie\n";
        let mut reader = Reader::from_reader(csv.as_bytes());
        let item: Item = reader.deserialize().next().unwrap().unwrap();
        assert_eq!(item.id, "tt0111161");
        assert_eq!(item.title_type, "movie");
        assert_eq!(item.your_rating, None);
        assert_eq!(item.date_rated, None);
    }
}
