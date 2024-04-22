use std::{
    fs::File,
    io::{BufReader, Read},
};

use async_graphql::Result;
use database::{ImportSource, MediaLot, MediaSource};
use flate2::bufread::GzDecoder;
use itertools::Itertools;
use rs_utils::{convert_naive_to_utc, convert_string_to_date};
use rust_decimal::{prelude::FromPrimitive, Decimal};
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{
    importer::{DeployMalImportInput, ImportResult},
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportItemRating, ImportOrExportMediaItem,
        ImportOrExportMediaItemSeen,
    },
};

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
    if date.starts_with("0000") {
        None
    } else {
        convert_string_to_date(&date).map(convert_naive_to_utc)
    }
}

fn convert_to_format(item: Item, lot: MediaLot) -> ImportOrExportMediaItem {
    let seen_history = (1..item.done + 1)
        .map(|i| {
            let (anime_episode, manga_chapter) = match lot {
                MediaLot::Anime => (Some(i), None),
                MediaLot::Manga => (None, Some(i)),
                _ => unreachable!(),
            };
            ImportOrExportMediaItemSeen {
                anime_episode_number: anime_episode,
                manga_chapter_number: manga_chapter,
                provider_watched_on: Some(ImportSource::Mal.to_string()),
                ..Default::default()
            }
        })
        .collect_vec();
    let review_item = ImportOrExportItemRating {
        review: None,
        rating: if item.my_score == 0 {
            None
        } else {
            Some(Decimal::from_u32(item.my_score).unwrap() * dec!(10))
        },
        ..Default::default()
    };
    ImportOrExportMediaItem {
        source_id: item.title.clone(),
        lot,
        source: MediaSource::Mal,
        identifier: "".to_string(),
        internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
            item.identifier.to_string(),
        )),
        seen_history,
        reviews: vec![review_item],
        collections: vec![],
    }
}

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    let anime_data = decode_data::<DataRoot>(&input.anime_path)?;
    let manga_data = decode_data::<DataRoot>(&input.manga_path)?;
    let mut media = vec![];
    for item in anime_data.items.into_iter() {
        media.push(convert_to_format(item, MediaLot::Anime));
    }
    for item in manga_data.items.into_iter() {
        media.push(convert_to_format(item, MediaLot::Manga));
    }
    Ok(ImportResult {
        media,
        ..Default::default()
    })
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
    my_score: u32,
}
