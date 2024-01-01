use async_graphql::Result;
use serde::Deserialize;

use crate::importer::{DeployGoodreadsImportInput, ImportResult};

#[derive(Debug, Deserialize)]
struct Book {
    #[serde(rename = "Book Id")]
    id: String,
    #[serde(rename = "ISBN13")]
    isbn13: String,
    #[serde(rename = "My Rating")]
    my_rating: i32,
    #[serde(rename = "Date Read")]
    date_read: Option<String>,
    #[serde(rename = "Bookshelves")]
    bookshelves: String,
    #[serde(rename = "My Review")]
    my_review: Option<String>,
    #[serde(rename = "Read Count")]
    read_count: i32,
}

pub async fn import(input: DeployGoodreadsImportInput) -> Result<ImportResult> {
    todo!()
}
