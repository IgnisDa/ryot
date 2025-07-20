use std::sync::Arc;

use anyhow::Result;
use application_utils::get_base_http_client;
use reqwest::Client;
use supporting_service::SupportingService;

pub static BASE_URL: &str = "https://www.giantbomb.com/api";

pub static ROLE_DEVELOPER: &str = "Developer";
pub static ROLE_PUBLISHER: &str = "Publisher";
pub static ROLE_PERSON: &str = "Person";

#[derive(Clone)]
pub struct GiantBombService {
    pub client: Client,
    pub api_key: String,
}

impl GiantBombService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self {
            client,
            api_key: ss.config.video_games.giant_bomb.api_key.clone(),
        })
    }
}
