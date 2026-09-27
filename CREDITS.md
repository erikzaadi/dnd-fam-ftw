# Credits and asset provenance

The project's own code and documentation are licensed under [AGPL-3.0-or-later](LICENSE). Bundled media below has its own source and terms, which the AGPL does not change. "Unresolved" marks provenance that has not been verified; please open an issue if you know the source of one of those files.

## Code

[Claude Code](https://claude.ai/code) (Anthropic) - AI pair programmer used throughout development.

## Runtime-generated images and audio

Scene images, adventure previews and hero portraits are generated at runtime by the configured OpenAI-compatible image model (`OPENAI_IMAGE_MODEL`, default `gpt-image-2`; see `.env.example`). Optional narration audio uses the configured TTS model (`OPENAI_MODEL_TTS`). None of this is bundled with the project.

## Bundled images (`frontend/public/images/`)

All AI-generated. Some AI-generated content may unintentionally resemble existing works; no guarantee of originality is made.

| Files | Source | Notes |
| --- | --- | --- |
| `intervention_dragon.png`, `sanctuary_light.png`, `dm_thinking.png`, `home_banner.png`, `first_run_wizard.png`, `campaign_over.png`, `icon_*.png` (7 icons) | Generated with `backend/src/scripts/generateStaticAssets.ts` (prompts in the `ASSETS` array) | The model used for each file is not recorded. Earlier credits said DALL·E 3; the script now uses the configured image model. |
| `onboarding/*.png` (preview, 5 scenes, 4 avatars) | Generated with `backend/src/scripts/generateStaticAssets.ts` | Quick-start adventure art. Same note on the model. |
| `campaign_over-1.png`, `campaign_over-2.png`, `default_scene.png` | Unresolved | Not in the generation script's asset list; presumed AI-generated. |

## Bundled music and sound effects (`frontend/public/sound/`)

Sourced from [Pixabay](https://pixabay.com/) and used under the [Pixabay Content License](https://pixabay.com/service/license-summary/), as recorded by the project owner. The filename keeps the Pixabay uploader and item ID (`<uploader>-<title>-<id>.mp3`). Files are used as part of the app, not redistributed as standalone assets.

| Files | Uploader (from filename) | Pixabay ID |
| --- | --- | --- |
| `music/ambient/deuslower-fantasy-medieval-ambient-237371.mp3` | deuslower | 237371 |
| `music/ambient/deuslower-fantasy-medieval-mystery-ambient-292418.mp3` | deuslower | 292418 |
| `music/ambient/dummy_daniel-party-at-the-tavern-468489.mp3` | dummy_daniel | 468489 |
| `music/ambient/ebunny-mystical-fantasy-loop-366827.mp3` | ebunny | 366827 |
| `music/ambient/sonican-cinematic-music-mystical-fantasy-loop-502813.mp3` | sonican | 502813 |
| `music/ambient/sonican-nocturnal-fantasy-enchanted-loop-284212.mp3` | sonican | 284212 |
| `music/ambient/sonican-wizard-rider-enchanted-fantasy-orchestral-loop-379413.mp3` | sonican | 379413 |
| `music/ambient/syouki_takahashi-midnight-forest-184304.mp3` | syouki_takahashi | 184304 |
| `music/danger/audioatlant-total-war-epic-action-cinematic-trailer-main-513668.mp3` | audioatlant | 513668 |
| `music/danger/cyberwave-orchestra-fantasy-war-epic-music-loop-289669.mp3` | cyberwave-orchestra | 289669 |
| `music/danger/paulyudin-battle-battle-music-491417.mp3` | paulyudin | 491417 |
| `music/danger/tunetank-epic-cinematic-battle-music-414662.mp3` | tunetank | 414662 |
| `sfx/dice-roll/freesound_community-rpg-dice-rolling-95182.mp3` | freesound_community | 95182 |
| `sfx/failed-roll/freesound_community-fail-jingle-stereo-mix-88784.mp3` | freesound_community | 88784 |
| `sfx/failed-roll/u_ss015dykrt-timpani-boing-fail-146292.mp3` | u_ss015dykrt | 146292 |
| `sfx/failed-roll/universfield-cartoon-fail-trumpet-278822.mp3` | universfield | 278822 |
| `sfx/failed-roll/universfield-fail-trumpet-02-383962.mp3` | universfield | 383962 |
| `sfx/narrating/freesound_community-dream-magic-prolonged-94891.mp3` | freesound_community | 94891 |
| `sfx/narrating/freesound_community-shimmering-object-79354.mp3` | freesound_community | 79354 |
| `sfx/success-roll/freesound_community-success-48018.mp3` | freesound_community | 48018 |
| `sfx/success-roll/freesound_community-success-fanfare-trumpets-6185.mp3` | freesound_community | 6185 |
| `sfx/success-roll/freesound_crunchpixstudio-great-success-384935.mp3` | crunchpixstudio | 384935 |
| `sfx/success-roll/freesound_crunchpixstudio-purchase-success-384963.mp3` | crunchpixstudio | 384963 |

**Unresolved:** `sfx/roll-20/huzzah-1.mp3` and the "silly mode" clips (`sfx/failed-roll/silly/*.mp3`, `sfx/roll-20/silly/*.mp3`) have no recorded source or license.

## Bundled voice samples (`frontend/public/sound/tts/`, `frontend/public/sound/tts-phrases/`)

Generated with OpenAI `gpt-4o-mini-tts` by `backend/src/scripts/generateStaticTtsAssets.ts`: one sample per voice for Settings, and short car-mode phrases per voice.
