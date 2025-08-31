use reqwest::Client;

pub struct TvdbService {
    pub client: Client,
    pub language: String,
}
