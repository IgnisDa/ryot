use anyhow::Result;
use common_utils::get_base_http_client;
use reqwest::Client;

#[derive(Debug, Clone)]
pub struct AnilistService {
    pub client: Client,
}

impl AnilistService {
    pub async fn new(_config: &config_definition::AnilistConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self { client })
    }

    pub fn get_all_languages(&self) -> Vec<String> {
        vec![
            "romaji".to_owned(),
            "native".to_owned(),
            "english".to_owned(),
            "user_preferred".to_owned(),
        ]
    }

    pub fn get_default_language(&self) -> String {
        "user_preferred".to_owned()
    }
}
