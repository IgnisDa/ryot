use serde::Deserialize;

pub static URL: &str = "https://api4.thetvdb.com/v4";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbLanguageResponse {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbLanguagesApiResponse {
    pub data: Vec<TvdbLanguageResponse>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbLoginData {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct TvdbLoginResponse {
    pub data: TvdbLoginData,
}
