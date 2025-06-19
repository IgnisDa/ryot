use std::{
    fs::File,
    io::{BufReader, Read},
};

use async_graphql::Result;
use common_utils::{convert_naive_to_utc, convert_string_to_date};
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource};
use flate2::bufread::GzDecoder;
use itertools::Itertools;
use media_models::{
    DeployMalImportInput, ImportOrExportItemRating, ImportOrExportMetadataItem,
    ImportOrExportMetadataItemSeen,
};
use rust_decimal::{Decimal, prelude::FromPrimitive};
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    let anime_data = input
        .anime_path
        .map(|p| decode_data::<DataRoot>(&p).unwrap())
        .unwrap_or_default();
    let manga_data = input
        .manga_path
        .map(|p| decode_data::<DataRoot>(&p).unwrap())
        .unwrap_or_default();
    let mut metadata = vec![];
    for item in anime_data.items.into_iter() {
        metadata.push(convert_to_format(item, MediaLot::Anime));
    }
    for item in manga_data.items.into_iter() {
        metadata.push(convert_to_format(item, MediaLot::Manga));
    }
    Ok(ImportResult {
        completed: metadata
            .into_iter()
            .map(ImportCompletedItem::Metadata)
            .collect(),
        ..Default::default()
    })
}

fn decode_data<T>(path: &str) -> Result<T>
where
    T: DeserializeOwned,
{
    let data = BufReader::new(File::open(path)?);
    let mut decoder = GzDecoder::new(data);
    let mut string_data = String::new();
    decoder.read_to_string(&mut string_data)?;
    let deserialized = serde_xml_rs::from_str::<T>(&string_data)?;
    Ok(deserialized)
}

fn get_date(date: String) -> Option<DateTimeUtc> {
    match date.as_str() {
        s if s.starts_with("0000") => None,
        _ => convert_string_to_date(&date).map(|d| convert_naive_to_utc(d)),
    }
}

fn convert_to_format(item: Item, lot: MediaLot) -> ImportOrExportMetadataItem {
    let seen_history = (1..item.done + 1)
        .map(|i| {
            let (anime_episode, manga_chapter) = match lot {
                MediaLot::Anime => (Some(i), None),
                MediaLot::Manga => (None, Some(Decimal::new(i as i64, 0))),
                _ => unreachable!(),
            };
            ImportOrExportMetadataItemSeen {
                started_on: get_date(item.my_start_date.clone()),
                ended_on: get_date(item.my_finish_date.clone()),
                anime_episode_number: anime_episode,
                manga_chapter_number: manga_chapter,
                provider_watched_on: Some(ImportSource::Myanimelist.to_string()),
                ..Default::default()
            }
        })
        .collect_vec();
    let review_item = ImportOrExportItemRating {
        rating: if item.my_score == 0 {
            None
        } else {
            Some(Decimal::from_u32(item.my_score).unwrap() * dec!(10))
        },
        ..Default::default()
    };
    ImportOrExportMetadataItem {
        lot,
        source: MediaSource::Myanimelist,
        identifier: item.identifier.to_string(),
        seen_history,
        source_id: item.title.clone(),
        reviews: vec![review_item],
        ..Default::default()
    }
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct DataRoot {
    #[serde(alias = "manga", alias = "anime")]
    items: Vec<Item>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Item {
    #[serde(alias = "series_animedb_id", alias = "manga_mangadb_id")]
    identifier: u32,
    #[serde(alias = "series_title", alias = "manga_title")]
    title: String,
    #[serde(alias = "series_episodes", alias = "manga_chapters")]
    total: i32,
    #[serde(alias = "my_watched_episodes", alias = "my_read_chapters")]
    done: i32,
    my_start_date: String,
    my_finish_date: String,
    my_score: u32,
}
