# Privacy and data

What the app stores, what leaves the server, and what you can delete. This describes how the software behaves; the operator of an instance decides retention, backups and which providers it uses. It is a factual explanation, not a certification.

## What goes to the AI provider

Every turn, preview, idea, Ask the DM question, recap and summary sends story context to the configured OpenAI-compatible provider (OpenAI by default, or whatever `OPENAI_BASE_URL` points at): the scene, recent turns and story summary, hero names, classes, quirks and history, the action text players type or dictate, and the adventure's setting and DM Prep notes. Scene, preview and portrait prompts go to the image model; with AI narration voice on, narration text goes to the TTS model.

The app does not send account email addresses or sign-in data to the AI provider. How long the provider keeps requests is governed by the provider's own terms and the operator's account settings.

## Playing from an AI assistant (MCP)

When you play through an assistant such as Claude, Codex or Cursor, the story (scenes, turns, hero details, the actions you type) also passes through that assistant's provider, under its terms. DM Prep, riddle answers and other private story state are not returned over MCP. You can revoke a token or disconnect an assistant any time under **Settings > AI assistants**.

## What the server stores

In its SQLite database:

- **Adventures:** settings, DM Prep, heroes, every turn's narration, actions and roll results, story summaries, riddles and encounter state.
- **Accounts** (when sign-in is on): email address, name, realm memberships, sign-in challenges (codes are stored hashed), pending invitations (only a hash of the link token), personal access tokens (hashed) and connected-assistant grants.
- **Usage records:** one row per AI provider request with the model, token counts, estimated cost, and which user and realm it was for. No prompt or story text.
- **Email outbox:** signup and "ask for more" notices waiting to be sent to the operator.

Server logs record requests (method, path, status, timing) and per-turn diagnostics without narration or player text.

## Images

Generated scene images, adventure previews and hero portraits are stored on local disk or in S3 and served from a public URL. The file names are hashes, so they are hard to guess, but anyone who has the URL can open the image: they are not private.

## Microphone and speech

- **Speech-to-text** (dictation, car mode) uses your browser's built-in speech recognition. Depending on the browser, audio may be sent to the browser vendor's servers (Chrome, for example, uses Google's service). The app only receives the recognized text.
- **Narration voice:** the default browser voice runs through your device's speech engine; the optional AI voice sends narration text to the configured TTS model.

## Deleting and exporting

| What | How |
| --- | --- |
| An adventure | Delete it from the home screen. Its turns, heroes, generated scene images and portraits are removed. |
| A hero | Remove it during party assembly. |
| Assistant access | Revoke the token or disconnect the assistant under **Settings > AI assistants**. |
| Your account | Ask the operator: accounts are removed with `users remove` ([MANAGE.md](../MANAGE.md#users)). Realms you own alone go with it; a shared realm must be handed to another member first. |
| Export | There is no self-service export. The operator can read an adventure's history as JSON (`/api/session/<id>/history`) or from a database backup. |

Database backups (on the author's AWS setup: daily, kept 90 days, see [operations.md](operations.md#cicd)) still contain deleted data until they expire.

## Hosted instance

Open items, pending the operator's policy for the hosted instance:

- Retention of adventures and accounts that are no longer used.
- Which AI provider account and data-retention settings the hosted instance uses.
- A contact for privacy and deletion requests (until then: a [GitHub issue](https://github.com/erikzaadi/dnd-fam-ftw/issues) without personal details, or the security reporting route in [CONTRIBUTING.md](../CONTRIBUTING.md#security-issues) for anything sensitive).

Self-hosters make these choices for their own instance.
