## Private Chat Client

This single-page web app provides a private frontend for large language model chat APIs. All conversation data is stored locally in your browser, allowing you to manage multiple chat threads without sending history to a remote server.

### Features
- Inline configuration for API endpoint, token, and model selection.
- Dynamic model list fetched from the configured endpoint (persisted per session).
- Multiple chat threads with localStorage persistence.
- Import/export of chat history as JSON.

### Getting Started
1. Open `index.html` in a modern browser (Chrome, Firefox, Edge).
2. Enter your API endpoint (e.g., `https://api.openai.com/v1/chat/completions`) and API token.
3. Refresh the model list to load available models, then choose the model you want to use.
4. Click **Save config** to persist settings for the current session.
5. Start chatting by submitting messages in the main panel. Use the sidebar to manage threads or export/import history.

### Notes
- Configuration is stored in `sessionStorage`, while threads are stored in `localStorage`.
- Model selections that are no longer offered by the endpoint are automatically replaced with the first available option when the list is refreshed.
- The app never transmits your configuration or history outside of requests you explicitly send to your configured endpoint.

### License

This project is licensed under the [Apache License 2.0](LICENSE).
