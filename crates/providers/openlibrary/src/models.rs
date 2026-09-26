use chrono::NaiveDate;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EditionsResponse {
    pub entries: Option<Vec<Edition>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Edition {
    pub key: String,
    pub title: Option<String>,
    pub covers: Option<Vec<i64>>,
    pub publish_date: Option<String>,
    pub number_of_pages: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum Description {
    Text(String),
    Nested {
        #[serde(rename = "type")]
        key: String,
        value: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BookSearchResults {
    pub total: u64,
    pub items: Vec<BookSearchItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct BookSearchItem {
    pub title: String,
    pub identifier: String,
    pub genres: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub author_names: Vec<String>,
    pub description: Option<String>,
    pub publish_date: Option<NaiveDate>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Key {
    pub key: String,
}

#[derive(Debug, Clone)]
pub struct OpenlibraryService {
    pub client: Client,
    pub image_url: String,
    pub image_size: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct MediaLibrarySearchResponse {
    pub num_found: u64,
    pub docs: Vec<MetadataSearchBook>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AuthorLibrarySearchResponse {
    #[serde(alias = "numFound")]
    pub num_found: u64,
    pub docs: Vec<PeopleSearchAuthor>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeopleSearchAuthor {
    pub key: String,
    pub name: String,
    pub birth_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonDetailsLink {
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonDetailsAuthor {
    pub key: String,
    pub name: String,
    pub bio: Option<Description>,
    pub photos: Option<Vec<i64>>,
    pub birth_date: Option<String>,
    pub death_date: Option<String>,
    pub links: Option<Vec<PersonDetailsLink>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MetadataDetailsAuthor {
    pub author: Key,
    #[serde(rename = "type", flatten)]
    pub role: Option<Key>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum MetadataDetailsAuthorResponse {
    Flat(Key),
    Nested(MetadataDetailsAuthor),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MetadataDetailsBook {
    pub key: String,
    pub title: String,
    pub covers: Option<Vec<i64>>,
    pub subjects: Option<Vec<String>>,
    pub description: Option<Description>,
    pub authors: Option<Vec<MetadataDetailsAuthorResponse>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MetadataSearchBook {
    pub key: String,
    pub title: String,
    pub cover_i: Option<i64>,
    pub publish_year: Option<Vec<i32>>,
    pub first_publish_year: Option<i32>,
    pub author_name: Option<Vec<String>>,
    pub number_of_pages_median: Option<i32>,
}
