use anyhow::Result;
use application_utils::get_base_http_client;
use reqwest::Client;

#[derive(Debug, Clone)]
pub struct AnilistService {
    pub client: Client,
    pub preferred_language: config_definition::AnilistPreferredLanguage,
}

impl AnilistService {
    pub async fn new(config: &config_definition::AnilistConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self {
            client,
            preferred_language: config.preferred_language.clone(),
        })
    }
}
