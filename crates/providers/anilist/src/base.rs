use anyhow::Result;
use common_utils::get_base_http_client;
use dependent_models::ProviderSupportedLanguageInformation;
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

    pub fn get_all_languages(&self) -> Vec<ProviderSupportedLanguageInformation> {
        vec![
            ProviderSupportedLanguageInformation {
                id: "english".to_owned(),
                label: "English".to_owned(),
            },
            ProviderSupportedLanguageInformation {
                id: "romaji".to_owned(),
                label: "Romaji".to_owned(),
            },
            ProviderSupportedLanguageInformation {
                id: "native".to_owned(),
                label: "Native".to_owned(),
            },
            ProviderSupportedLanguageInformation {
                id: "user_preferred".to_owned(),
                label: "User Preferred".to_owned(),
            },
        ]
    }

    pub fn get_default_language(&self) -> String {
        "user_preferred".to_owned()
    }
}
