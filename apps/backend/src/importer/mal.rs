use std::{
    fs::File,
    io::{BufReader, Read},
};

use async_graphql::Result;
use flate2::bufread::GzDecoder;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::importer::{DeployMalImportInput, ImportResult};

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

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    let anime_data = decode_data::<DataRoot>(&input.anime)?;
    dbg!(&anime_data);
    let manga_data = decode_data::<DataRoot>(&input.manga)?;
    dbg!(&manga_data);
    Ok(ImportResult {
        collections: vec![],
        media: vec![],
        failed_items: vec![],
    })
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct DataRoot {
    #[serde(alias = "manga", alias = "anime")]
    items: Vec<Item>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Item {
    series_animedb_id: Option<u32>,
    series_mangadb_id: Option<u32>,
    series_title: Option<String>,
    manga_title: Option<String>,
    series_type: Option<String>,
    series_episodes: Option<u32>,
    manga_chapters: Option<u32>,
    my_watched_episodes: Option<u32>,
    my_read_chapters: Option<u32>,
    my_start_date: String,
    my_finish_date: String,
    my_score: u32,
}
