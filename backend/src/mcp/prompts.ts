import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Optional convenience prompts. Play never depends on them: every rule they carry is
// also in the server instructions and tool descriptions.

const text = (value: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: value } }] });

export const registerPrompts = (server: McpServer): void => {
  server.registerPrompt('start_adventure', {
    title: 'Start a new adventure',
    description: 'Start a new one-evening, text-only adventure from an idea.',
    argsSchema: {
      idea: z.string().max(600).optional().describe('What the adventure should be about.'),
      heroes: z.string().max(600).optional().describe('Optional: the heroes to play, e.g. "a gnome bard named Pip and an elf wizard".'),
    },
  }, ({ idea, heroes }) => text([
    `Start a new D&D adventure with the dnd-fam-ftw server${idea ? ` about: ${idea}` : ''}.`,
    heroes ? `Heroes: ${heroes}. Pass them to create_adventure as hero descriptions.` : 'Let the DM make the party (heroes "auto") unless I describe heroes.',
    'Use create_adventure with a fresh requestId, wait with get_operation, then tell me the origin story, introduce each hero in one line, show me the opening scene, and ask what we do.',
    'The server is the DM: never invent rolls or outcomes, and preview each of my actions before confirming it with me.',
  ].join(' ')));

  server.registerPrompt('resume_adventure', {
    title: 'Resume an adventure',
    description: 'Pick up an adventure where it left off.',
    argsSchema: {
      title: z.string().max(200).optional().describe('Name of the adventure, if known.'),
    },
  }, ({ title }) => text([
    title ? `Resume the adventure "${title}".` : 'Show my adventures with list_adventures and ask which one to resume.',
    'Read it with get_adventure, summarize where we are from the latest turns in a few sentences, show any operation still in progress, and ask what we do next.',
  ].join(' ')));
};
