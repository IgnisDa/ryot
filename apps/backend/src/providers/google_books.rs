use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::{AudibleConfig, GoogleBooksConfig},
    graphql::{AUTHOR, PROJECT_NAME},
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl, PAGE_LIMIT,
    },
    models::media::AudioBookSpecifics,
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, convert_string_to_date, NamedObject},
};

pub static URL: &str = "https://www.googleapis.com/books/v1/volumes";

#[derive(Debug, Clone)]
pub struct GoogleBooksService {
    client: Client,
}

impl MediaProviderLanguages for GoogleBooksService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl GoogleBooksService {
    pub fn new(config: &GoogleBooksConfig) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .set_base_url(Url::parse(URL).unwrap())
            .try_into()
            .unwrap();
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for GoogleBooksService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        todo!();
    }
}
