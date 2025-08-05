use anyhow::Result;
use application_utils::get_base_http_client;

use crate::{
    models::{MetadataDetailsBook, OpenlibraryService},
    utilities::get_key,
};

pub static URL: &str = "https://openlibrary.org";
pub static IMAGE_BASE_URL: &str = "https://covers.openlibrary.org";

impl OpenlibraryService {
    pub async fn new(config: &config_definition::OpenlibraryConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self {
            image_url: IMAGE_BASE_URL.to_owned(),
            image_size: config.cover_image_size.to_string(),
            client,
        })
    }

    pub fn get_book_cover_image_url(&self, c: u64) -> String {
        self.get_cover_image_url("b", c)
    }

    pub fn get_author_cover_image_url(&self, c: u64) -> String {
        self.get_cover_image_url("a", c)
    }

    pub fn get_cover_image_url(&self, t: &str, c: u64) -> String {
        format!(
            "{}/{}/id/{}-{}.jpg?default=false",
            self.image_url, t, c, self.image_size
        )
    }

    pub async fn id_from_isbn(&self, isbn: &str) -> Option<String> {
        self.client
            .get(format!("{URL}/isbn/{isbn}.json"))
            .send()
            .await
            .ok()?
            .json::<MetadataDetailsBook>()
            .await
            .ok()
            .map(|data| get_key(&data.key))
    }
}
