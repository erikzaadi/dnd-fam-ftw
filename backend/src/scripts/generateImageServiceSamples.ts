/**
 * Generates a small set of real ImageService samples for prompt validation.
 *
 * Run from backend/:
 *   npx tsx --env-file=../.env src/scripts/generateImageServiceSamples.ts
 *
 * Add --reuse-id to reuse a stable session id and exercise cache hits:
 *   npx tsx --env-file=../.env src/scripts/generateImageServiceSamples.ts --reuse-id
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../config/env.js';
import { ImageService, type ImageResult, type SceneImageContext } from '../services/imageService.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'), quiet: true });

type AvatarSampleResult = ImageResult & { prompt: string };

type SampleResult = {
  label: string;
  url: string;
  storageKey: string;
  storageProvider: string;
  fullPath: string | null;
  samplePath: string | null;
};

const reuseId = process.argv.includes('--reuse-id');
const sampleId = reuseId
  ? 'stable'
  : new Date().toISOString().replace(/[-:.]/g, '').replace('T', '_').replace('Z', '');

function sampleName(type: string): string {
  return `image_service_samples_${type}_${sampleId}`;
}

const party = [
  {
    id: 'sample-c1',
    name: 'Marla Moonspoon',
    class: 'Wizard',
    species: 'Gnome',
    quirk: 'Collects cursed spoons and whispers riddles to them',
    gender: 'female',
    status: 'active',
  },
  {
    id: 'sample-c2',
    name: 'Brondle Geargrin',
    class: 'Fighter',
    species: 'Dwarf',
    quirk: 'Names every door before headbutting it',
    gender: 'male',
    status: 'active',
  },
];

const fullSession = {
  id: sampleName('preview_full'),
  displayName: 'The Clockwork Moon Market',
  worldDescription: 'A canal-crossed moonlit market district where clockwork towers chime above floating lantern boats and glass-roofed arcades',
  dmPrep: 'The Brass Duchess is using enchanted market stalls to distract the city while her clockwork beetles steal moon crystals from the observatory vault.',
  dmPrepImageBrief: 'masked brass duchess, clockwork beetle scouts, moon crystal observatory, lantern boats, glass market arcades, blue-gold magical glow',
  difficulty: 'normal',
  gameMode: 'cinematic',
  party,
};

const minimalSession = {
  id: sampleName('preview_minimal'),
  displayName: 'The Quiet Lantern Road',
  party,
};

const turnContext: SceneImageContext = {
  worldDescription: fullSession.worldDescription,
  dmPrepImageBrief: fullSession.dmPrepImageBrief,
  party,
  activeCharacterId: party[0].id,
};

function getLocalImagePath(storageProvider: string, storageKey: string): string | null {
  if (storageProvider !== 'local' || !storageKey) {
    return null;
  }

  return path.resolve(getConfig().LOCAL_IMAGE_STORAGE_PATH, storageKey);
}

function getSampleImagePath(type: string, sourcePath: string | null): string | null {
  if (!sourcePath) {
    return null;
  }

  const samplePath = path.resolve(getConfig().LOCAL_IMAGE_STORAGE_PATH, `${sampleName(type)}${path.extname(sourcePath) || '.jpg'}`);
  fs.copyFileSync(sourcePath, samplePath);
  return samplePath;
}

function normalizeAvatarResult(type: string, result: AvatarSampleResult): SampleResult {
  const fullPath = getLocalImagePath(result.storageProvider, result.storageKey);
  return {
    label: 'avatar',
    url: result.url,
    storageKey: result.storageKey,
    storageProvider: result.storageProvider,
    fullPath,
    samplePath: getSampleImagePath(type, fullPath),
  };
}

function normalizeImageResult(type: string, label: string, result: ImageResult | null): SampleResult | null {
  if (!result) {
    return null;
  }

  const fullPath = getLocalImagePath(result.storageProvider, result.storageKey);
  return {
    label,
    url: result.url,
    storageKey: result.storageKey,
    storageProvider: result.storageProvider,
    fullPath,
    samplePath: getSampleImagePath(type, fullPath),
  };
}

async function main(): Promise<void> {
  console.log(`[ImageSamples] Generating samples with id: ${sampleId}`);
  console.log('[ImageSamples] Using ImageService directly with configured provider and storage.');

  const results: SampleResult[] = [];

  const previewFull = await ImageService.generateSessionPreview(fullSession);
  const previewMinimal = await ImageService.generateSessionPreview(minimalSession);
  const avatarWizard = await ImageService.generateAvatar(party[0], sampleName('avatar_wizard'));
  const avatarFighter = await ImageService.generateAvatar(party[1], sampleName('avatar_fighter'));

  const combatTurn = await ImageService.generateImage(
    'A moonlit market square erupts into action as clockwork beetle scouts swarm between lantern stalls, a gnome wizard throws a burst of blue-gold magical light, and a dwarf fighter shields the party beside a canal bridge.',
    sampleName('turn_combat'),
    1,
    undefined,
    undefined,
    {
      ...turnContext,
      activeCharacterId: party[1].id,
      currentTensionLevel: 'high',
    },
  );

  const explorationTurn = await ImageService.generateImage(
    'The party explores a quiet glass-roofed arcade after the battle, following soft reflections across wet cobblestones toward a hidden observatory door while lantern boats drift through the canal outside.',
    sampleName('turn_exploration'),
    2,
    undefined,
    undefined,
    {
      ...turnContext,
      activeCharacterId: party[0].id,
      currentTensionLevel: 'low',
    },
  );

  const normalizedResults = [
    normalizeImageResult('preview_full', 'session preview - full description and DM prep', previewFull),
    normalizeImageResult('preview_minimal', 'session preview - minimal description', previewMinimal),
    { ...normalizeAvatarResult('avatar_wizard', avatarWizard), label: 'avatar - quirked wizard' },
    { ...normalizeAvatarResult('avatar_fighter', avatarFighter), label: 'avatar - quirked fighter' },
    normalizeImageResult('turn_combat', 'turn image - combat', combatTurn),
    normalizeImageResult('turn_exploration', 'turn image - exploration', explorationTurn),
  ];

  for (const result of normalizedResults) {
    if (result) {
      results.push(result);
    } else {
      console.warn('[ImageSamples] One sample returned null.');
    }
  }

  console.log('\n[ImageSamples] Generated images:');
  for (const result of results) {
    console.log(`- ${result.label}`);
    console.log(`  url: ${result.url}`);
    console.log(`  storage: ${result.storageProvider}`);
    console.log(`  key: ${result.storageKey || '(fallback/no storage key)'}`);
    console.log(`  imageService path: ${result.fullPath ?? '(not a local file path)'}`);
    console.log(`  sample path: ${result.samplePath ?? '(not a local file path)'}`);
  }
}

main().catch(error => {
  console.error('[ImageSamples] Failed:', error);
  process.exitCode = 1;
});
