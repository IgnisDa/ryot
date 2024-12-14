use anyhow::Result;
use async_trait::async_trait;
use media_models::MetadataDetails;
use rustypipe::param::{Language, LANGUAGES};
use traits::{MediaProvider, MediaProviderLanguages};

#[derive(Debug, Clone)]
pub struct YoutubeMusicService {}

impl YoutubeMusicService {
    pub async fn new() -> Self {
        Self {}
    }
}

impl MediaProviderLanguages for YoutubeMusicService {
    fn supported_languages() -> Vec<String> {
        LANGUAGES.iter().map(|l| l.name().to_owned()).collect()
    }

    fn default_language() -> String {
        Language::En.name().to_owned()
    }
}

#[async_trait]
impl MediaProvider for YoutubeMusicService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        todo!()
    }
}
