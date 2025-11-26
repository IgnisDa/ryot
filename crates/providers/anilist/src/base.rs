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
}
