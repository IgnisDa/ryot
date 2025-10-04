use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{self, BufReader},
    path::PathBuf,
    sync::Arc,
};

use anyhow::{Result, bail};
use chrono::{DateTime, NaiveDateTime, Utc};
use common_models::DefaultCollection;
use common_utils::ryot_log;
use csv::Reader;
use dependent_models::{CollectionToEntityDetails, ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource};
use indexmap::IndexMap;
use media_models::{
    DeployPathImportInput, ImportOrExportItemRating, ImportOrExportMetadataItemSeen,
    MetadataLookupResponse,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Deserialize;
use supporting_service::SupportingService;
use uuid::Uuid;
use zip::ZipArchive;

use crate::{ImportFailStep, ImportFailedItem, ImportOrExportMetadataItem};

#[derive(Debug, Clone)]
struct LookupCacheItem {
    lot: MediaLot,
    source: MediaSource,
    identifier: String,
    season: Option<i32>,
    episode: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct ViewingActivityItem {
    #[serde(rename = "Duration")]
    duration: String,
    #[serde(rename = "Start Time")]
    start_time: String,
    #[serde(rename = "Bookmark")]
    bookmark: String,
    #[serde(rename = "Latest Bookmark")]
    latest_bookmark: String,
    #[serde(rename = "Supplemental Video Type")]
    supplemental_video_type: String,
    #[serde(rename = "Attributes")]
    attributes: String,
    #[serde(rename = "Title")]
    title: String,
}

#[derive(Debug, Deserialize)]
struct RatingItem {
    #[serde(rename = "Title Name")]
    title_name: String,
    #[serde(rename = "Star Value")]
    star_value: Option<i32>,
    #[serde(rename = "Thumbs Value")]
    thumbs_value: Option<i32>,
    #[serde(rename = "Event Utc Ts")]
    event_utc_ts: String,
}

#[derive(Debug, Deserialize)]
struct MyListItem {
    #[serde(rename = "Title Name")]
    title_name: String,
}

fn should_skip_entry(item: &ViewingActivityItem) -> bool {
    if !item.supplemental_video_type.is_empty() {
        return true;
    }
    if item.latest_bookmark == "Not latest view" {
        return true;
    }
    if item.attributes.contains("Autoplayed: user action: None;") {
        return true;
    }
    if item.title.contains("_hook_")
        || item.title.contains("Clip:")
        || item.title.contains("Trailer:")
        || item.title.contains("_backfill")
    {
        return true;
    }
    false
}

fn parse_time_to_seconds(time_str: &str) -> Option<i32> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: i32 = parts[0].parse().ok()?;
    let minutes: i32 = parts[1].parse().ok()?;
    let seconds: i32 = parts[2].parse().ok()?;
    Some(hours * 3600 + minutes * 60 + seconds)
}

fn convert_rating(thumbs: Option<i32>, stars: Option<i32>) -> Option<Decimal> {
    if let Some(star_value) = stars {
        Some(Decimal::from(star_value * 20))
    } else if let Some(thumbs_value) = thumbs {
        match thumbs_value {
            0 => None,
            1 => Some(dec!(33)),
            2 => Some(dec!(67)),
            3 => Some(dec!(100)),
            _ => None,
        }
    } else {
        None
    }
}

fn parse_netflix_timestamp(timestamp: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc))
}

fn extract_zip(zip_path: &str) -> Result<PathBuf> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(BufReader::new(file))?;
    let temp_dir = env::temp_dir().join(format!("netflix_import_{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let output_path = temp_dir.join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&output_path)?;
        } else {
            if let Some(p) = output_path.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)?;
                }
            }
            let mut output_file = File::create(&output_path)?;
            io::copy(&mut file, &mut output_file)?;
        }
    }

    Ok(temp_dir)
}

async fn lookup_title(
    ss: &Arc<SupportingService>,
    title: &str,
    title_cache: &mut HashMap<String, Option<LookupCacheItem>>,
    failed_items: &mut Vec<ImportFailedItem>,
) -> Option<LookupCacheItem> {
    if let Some(cached) = title_cache.get(title) {
        return cached.clone();
    }

    let lookup_result = miscellaneous_lookup_service::metadata_lookup(ss, title.to_string()).await;
    let item = match lookup_result {
        Ok(result) => match result.response {
            MetadataLookupResponse::Found(found) => Some(LookupCacheItem {
                lot: found.data.lot,
                source: found.data.source,
                identifier: found.data.identifier,
                season: found.show_information.as_ref().map(|s| s.season),
                episode: found.show_information.as_ref().map(|s| s.episode),
            }),
            MetadataLookupResponse::NotFound(_) => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: title.to_string(),
                    error: Some("Metadata not found".to_string()),
                });
                None
            }
        },
        Err(e) => {
            failed_items.push(ImportFailedItem {
                lot: None,
                step: ImportFailStep::ItemDetailsFromSource,
                identifier: title.to_string(),
                error: Some(format!("Metadata lookup error: {e:#?}")),
            });
            None
        }
    };
    title_cache.insert(title.to_string(), item.clone());
    item
}

pub async fn import(
    input: DeployPathImportInput,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    ryot_log!(debug, "Starting Netflix import from: {}", input.export_path);

    let extracted_dir = extract_zip(&input.export_path)?;
    ryot_log!(debug, "Extracted ZIP to: {:?}", extracted_dir);

    let content_dir = extracted_dir.join("CONTENT_INTERACTION");
    if !content_dir.exists() {
        bail!("CONTENT_INTERACTION folder not found in Netflix export");
    }

    let viewing_activity_path = content_dir.join("ViewingActivity.csv");
    let ratings_path = content_dir.join("Ratings.csv");
    let my_list_path = content_dir.join("MyList.csv");

    let mut media_map: IndexMap<String, ImportOrExportMetadataItem> = IndexMap::new();
    let mut failed_items = vec![];
    let mut title_cache: HashMap<String, Option<LookupCacheItem>> = HashMap::new();

    if viewing_activity_path.exists() {
        ryot_log!(debug, "Processing ViewingActivity.csv");
        let mut reader = Reader::from_path(&viewing_activity_path)?;
        let mut viewing_items = vec![];

        for (idx, result) in reader.deserialize().enumerate() {
            let record: ViewingActivityItem = match result {
                Ok(r) => r,
                Err(e) => {
                    failed_items.push(ImportFailedItem {
                        lot: None,
                        step: ImportFailStep::InputTransformation,
                        identifier: idx.to_string(),
                        error: Some(format!("ViewingActivity CSV parsing error: {e:#?}")),
                    });
                    continue;
                }
            };

            if should_skip_entry(&record) {
                continue;
            }

            viewing_items.push(record);
        }

        ryot_log!(
            debug,
            "Processing {} viewing activity entries",
            viewing_items.len()
        );

        for (idx, record) in viewing_items.into_iter().enumerate() {
            if idx % 100 == 0 {
                ryot_log!(debug, "Processed {idx} viewing entries");
            }

            if let Some(lookup) =
                lookup_title(ss, &record.title, &mut title_cache, &mut failed_items).await
            {
                let ended_on = parse_netflix_timestamp(&record.start_time);
                let bookmark_seconds = parse_time_to_seconds(&record.bookmark);
                let duration_seconds = parse_time_to_seconds(&record.duration);

                let progress = if let (Some(bookmark), Some(duration)) =
                    (bookmark_seconds, duration_seconds)
                {
                    if duration > 0 {
                        Some(Decimal::from(bookmark * 100 / duration))
                    } else {
                        None
                    }
                } else {
                    None
                };

                let seen_item = ImportOrExportMetadataItemSeen {
                    ended_on,
                    progress,
                    show_season_number: lookup.season,
                    show_episode_number: lookup.episode,
                    providers_consumed_on: Some(vec![ImportSource::Netflix.to_string()]),
                    ..Default::default()
                };

                let key = format!(
                    "{}:{}:{}",
                    lookup.identifier,
                    lookup.season.unwrap_or(0),
                    lookup.episode.unwrap_or(0)
                );

                media_map
                    .entry(key)
                    .or_insert_with(|| ImportOrExportMetadataItem {
                        lot: lookup.lot,
                        source: lookup.source,
                        identifier: lookup.identifier.clone(),
                        source_id: record.title.clone(),
                        ..Default::default()
                    })
                    .seen_history
                    .push(seen_item);
            }
        }
    }

    if ratings_path.exists() {
        ryot_log!(debug, "Processing Ratings.csv");
        let mut reader = Reader::from_path(&ratings_path)?;

        for (idx, result) in reader.deserialize().enumerate() {
            let record: RatingItem = match result {
                Ok(r) => r,
                Err(e) => {
                    failed_items.push(ImportFailedItem {
                        lot: None,
                        step: ImportFailStep::InputTransformation,
                        identifier: idx.to_string(),
                        error: Some(format!("Ratings CSV parsing error: {e:#?}")),
                    });
                    continue;
                }
            };

            let rating_value = convert_rating(record.thumbs_value, record.star_value);
            if rating_value.is_none() {
                continue;
            }

            if let Some(lookup) =
                lookup_title(ss, &record.title_name, &mut title_cache, &mut failed_items).await
            {
                let review_date = parse_netflix_timestamp(&record.event_utc_ts);
                let rating = ImportOrExportItemRating {
                    rating: rating_value,
                    review: Some(media_models::ImportOrExportItemReview {
                        date: review_date,
                        spoiler: Some(false),
                        ..Default::default()
                    }),
                    ..Default::default()
                };

                let key = format!(
                    "{}:{}:{}",
                    lookup.identifier,
                    lookup.season.unwrap_or(0),
                    lookup.episode.unwrap_or(0)
                );

                media_map
                    .entry(key)
                    .or_insert_with(|| ImportOrExportMetadataItem {
                        lot: lookup.lot,
                        source: lookup.source,
                        identifier: lookup.identifier.clone(),
                        source_id: record.title_name.clone(),
                        ..Default::default()
                    })
                    .reviews
                    .push(rating);
            }
        }
    }

    if my_list_path.exists() {
        ryot_log!(debug, "Processing MyList.csv");
        let mut reader = Reader::from_path(&my_list_path)?;

        for (idx, result) in reader.deserialize().enumerate() {
            let record: MyListItem = match result {
                Ok(r) => r,
                Err(e) => {
                    failed_items.push(ImportFailedItem {
                        lot: None,
                        step: ImportFailStep::InputTransformation,
                        identifier: idx.to_string(),
                        error: Some(format!("MyList CSV parsing error: {e:#?}")),
                    });
                    continue;
                }
            };

            if let Some(lookup) =
                lookup_title(ss, &record.title_name, &mut title_cache, &mut failed_items).await
            {
                let key = format!(
                    "{}:{}:{}",
                    lookup.identifier,
                    lookup.season.unwrap_or(0),
                    lookup.episode.unwrap_or(0)
                );

                media_map
                    .entry(key)
                    .or_insert_with(|| ImportOrExportMetadataItem {
                        lot: lookup.lot,
                        source: lookup.source,
                        identifier: lookup.identifier.clone(),
                        source_id: record.title_name.clone(),
                        ..Default::default()
                    })
                    .collections
                    .push(CollectionToEntityDetails {
                        collection_name: DefaultCollection::Watchlist.to_string(),
                        ..Default::default()
                    });
            }
        }
    }

    let _ = fs::remove_dir_all(&extracted_dir);

    ryot_log!(
        debug,
        "Netflix import completed with {} items",
        media_map.len()
    );

    Ok(ImportResult {
        failed: failed_items,
        completed: media_map
            .into_values()
            .map(ImportCompletedItem::Metadata)
            .collect(),
    })
}
