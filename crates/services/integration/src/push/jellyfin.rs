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
        Ok(())
    }
}
