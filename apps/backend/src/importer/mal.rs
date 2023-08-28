use std::{
    fs::File,
    io::{BufReader, Read},
};

use async_graphql::Result;
use flate2::bufread::GzDecoder;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{
    importer::{DeployMalImportInput, ImportResult},
    migrator::{MetadataLot, MetadataSource},
    models::media::{ImportOrExportItemIdentifier, ImportOrExportMediaItem},
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

fn convert_to_format(
    item: Item,
    lot: MetadataLot,
) -> ImportOrExportMediaItem<ImportOrExportItemIdentifier> {
    ImportOrExportMediaItem {
        source_id: item.title,
        lot,
        source: MetadataSource::Mal,
        identifier: ImportOrExportItemIdentifier::NeedsDetails(item.identifier.to_string()),
        seen_history: vec![],
        reviews: vec![],
        collections: vec![],
    }
}

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    let anime_data = decode_data::<DataRoot>(&input.anime)?;
    let manga_data = decode_data::<DataRoot>(&input.manga)?;
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
    total: u32,
    #[serde(alias = "my_watched_episodes", alias = "my_read_chapters")]
    done: u32,
    my_start_date: String,
    my_finish_date: String,
    my_score: u32,
}
