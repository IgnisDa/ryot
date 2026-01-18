use std::sync::Arc;

use anyhow::Result;
use common_utils::get_base_http_client;
use dependent_models::ProviderSupportedLanguageInformation;
use reqwest::Client;
use supporting_service::SupportingService;

#[derive(Clone)]
pub struct AnilistService {
    pub client: Client,
    pub ss: Arc<SupportingService>,
}

impl AnilistService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self { client, ss })
    }

    pub fn get_all_languages(&self) -> Vec<ProviderSupportedLanguageInformation> {
        vec![
            ProviderSupportedLanguageInformation {
                value: "english".to_owned(),
                label: "English".to_owned(),
            },
            ProviderSupportedLanguageInformation {
                value: "romaji".to_owned(),
                label: "Romaji".to_owned(),
            },
            ProviderSupportedLanguageInformation {
                value: "native".to_owned(),
                label: "Native".to_owned(),
            },
            ProviderSupportedLanguageInformation {
                value: "user_preferred".to_owned(),
                label: "User Preferred".to_owned(),
            },
        ]
    }
}
