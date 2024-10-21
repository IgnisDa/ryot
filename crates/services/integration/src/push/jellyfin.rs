use external_utils::jellyfin::get_authenticated_client;

pub(crate) struct JellyfinPushIntegration {
    base_url: String,
    username: String,
    password: String,
}

impl JellyfinPushIntegration {
    pub const fn new(base_url: String, username: String, password: String) -> Self {
        Self {
            base_url,
            username,
            password,
        }
    }

    pub async fn push_progress(&self) -> anyhow::Result<()> {
        let (client, user_id) =
            get_authenticated_client(&self.base_url, &self.username, &self.password).await?;
        Ok(())
    }
}
