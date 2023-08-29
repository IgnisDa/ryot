use std::{
    fs::File,
    io::{BufReader, Read},
};

use async_graphql::Result;
use flate2::bufread::GzDecoder;
use rust_decimal::{prelude::FromPrimitive, Decimal};
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{
    importer::{DeployMalImportInput, ImportResult},
    migrator::{MetadataLot, MetadataSource},
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportItemRating, ImportOrExportMediaItem,
        ImportOrExportMediaItemSeen,
    },
    utils::{convert_naive_to_utc, convert_string_to_date},
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

fn convert_to_format(
    item: Item,
    lot: MetadataLot,
) -> ImportOrExportMediaItem<ImportOrExportItemIdentifier> {
    let progress = if item.done != 0 && item.total != 0 {
        Some(item.done / item.total)
    } else {
        None
    };
    let seen_item = ImportOrExportMediaItemSeen {
        started_on: get_date(item.my_start_date),
        ended_on: get_date(item.my_finish_date),
        progress,
        ..Default::default()
    };
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
        source_id: item.title,
        lot,
        source: MetadataSource::Mal,
        identifier: ImportOrExportItemIdentifier::NeedsDetails(item.identifier.to_string()),
        seen_history: vec![seen_item],
        reviews: vec![review_item],
        collections: vec![],
    }
}

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    let anime_data = decode_data::<DataRoot>(&input.anime_path)?;
    let manga_data = decode_data::<DataRoot>(&input.manga_path)?;
    let mut media = vec![];
    for item in anime_data.items.into_iter() {
        media.push(convert_to_format(item, MetadataLot::Anime));
    }
    for item in manga_data.items.into_iter() {
        media.push(convert_to_format(item, MetadataLot::Manga));
    }
    Ok(ImportResult {
        collections: vec![],
        failed_items: vec![],
        media,
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
    my_start_date: String,
    my_finish_date: String,
    my_score: u32,
}
