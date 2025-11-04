## Private Chat Client

This single-page web app provides a private frontend for large language model chat APIs. All conversation data is stored locally in your browser, allowing you to manage multiple chat threads without sending history to a remote server.

### Features
- Inline configuration for API endpoint, token, and model selection.
- Dynamic model list fetched from the configured endpoint (persisted per session).
- Multiple chat threads with localStorage persistence.
- Import/export of chat history and session configuration as JSON.
- Responsive layout with a collapsible settings panel that adapts to mobile and desktop.

### Getting Started
1. Open `index.html` in a modern browser (Chrome, Firefox, Edge).
2. Enter your API base URL (e.g., `https://api.openai.com/v1`) and API token—the app automatically calls the `/chat/completions` route when you send a message.
3. Refresh the model list to load available models, then choose the model you want to use.
4. Click **Save config** to persist settings for the current session.
5. Start chatting by submitting messages in the main panel. Use the sidebar to manage threads or export/import history.

### Notes
- Configuration is stored in `sessionStorage`, while threads are stored in `localStorage`.
- Model selections that are no longer offered by the endpoint are automatically replaced with the first available option when the list is refreshed.
- The app never transmits your configuration or history outside of requests you explicitly send to your configured endpoint.

### Deploying to GitLab Pages
1. Create a GitLab project (public or private) and push this repository to it.
2. The included `.gitlab-ci.yml` copies `index.html` (and the `LICENSE`) into the `public/` artifact so GitLab Pages can serve it. The pipeline runs on commits to `main`; adjust if you use a different default branch.
3. Once the pipeline succeeds, enable **Settings ▸ Pages** in GitLab to view the default `https://<namespace>.gitlab.io/<project>` URL.
4. To use `privatelocalchat.com`:
   - In **Settings ▸ Pages**, add a new custom domain and follow the prompts.
   - Create the required DNS records with your registrar: a TXT record for domain verification and a CNAME/ALIAS/ANAME pointing `privatelocalchat.com` to the GitLab Pages host indicated in the setup instructions (typically `<namespace>.gitlab.io` or `lb.gitlab.io` for apex domains).
   - Wait for DNS to propagate, then click “Verify” in GitLab. Optionally enable HTTPS; GitLab will issue a Let’s Encrypt certificate once the domain is verified.

### License

This project is licensed under the [Apache License 2.0](LICENSE).
