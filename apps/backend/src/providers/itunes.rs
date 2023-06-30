use anyhow::{anyhow, Result};
use async_trait::async_trait;
use convert_case::{Case, Casing};
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::ITunesConfig,
    graphql::USER_AGENT_STR,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl, PAGE_LIMIT,
    },
    models::media::BookSpecifics,
    traits::{MediaProvider, MediaProviderLanguages},
    utils::convert_date_to_year,
};

pub static URL: &str = "https://itunes.apple.com/";

#[derive(Debug, Clone)]
pub struct ITunesService {
    client: Client,
}

impl MediaProviderLanguages for ITunesService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl ITunesService {
    pub async fn new(_config: &ITunesConfig) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, USER_AGENT_STR)
            .unwrap()
            .set_base_url(Url::parse(URL).unwrap())
            .try_into()
            .unwrap();
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for ITunesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        todo!()
    }
}
