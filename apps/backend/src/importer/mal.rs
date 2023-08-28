use std::{
    fs::File,
    io::{BufReader, Read},
};

use async_graphql::Result;
use flate2::bufread::GzDecoder;

use crate::importer::{DeployMalImportInput, ImportResult};

fn decode_data(path: &str) -> Result<String> {
    let data = BufReader::new(File::open(path)?);
    let mut decoder = GzDecoder::new(data);
    let mut string_data = String::new();
    decoder.read_to_string(&mut string_data)?;
    Ok(string_data)
}

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    dbg!(&input);
    let anime_data = decode_data("tmp/animelist_1693016277_-_14391783.xml.gz")?;
    dbg!(&anime_data);
    Ok(ImportResult {
        collections: vec![],
        media: vec![],
        failed_items: vec![],
    })
}
