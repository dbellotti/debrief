import { parseClaudeSession, condenseClaude } from "./claude-code.mjs";
import { parseCodexSession, condenseCodex } from "./codex.mjs";
import { parseClaudeAiSession, condenseClaudeAi } from "./claude-ai.mjs";
import { parseOpenAiSession, condenseOpenAi } from "./openai.mjs";

const parsers = {
  claude: {
    parse: (t) => parseClaudeSession(t.raw, t.machine),
    condense: (t) => { const s = condenseClaude(t.raw, t.filepath); s.machine = t.machine; return s; },
  },
  codex: {
    parse: (t) => parseCodexSession(t.raw, t.machine),
    condense: (t) => { const s = condenseCodex(t.raw, t.filepath); s.machine = t.machine; return s; },
  },
  "claude-ai": {
    parse: (t) => parseClaudeAiSession(t.raw),
    condense: (t) => condenseClaudeAi(t.raw),
  },
  openai: {
    parse: (t) => parseOpenAiSession(t.raw),
    condense: (t) => condenseOpenAi(t.raw),
  },
};

export function parse(tuple) {
  const p = parsers[tuple.provider];
  if (!p) throw new Error(`Unknown provider: ${tuple.provider}`);
  return p.parse(tuple);
}

export function condense(tuple) {
  const p = parsers[tuple.provider];
  if (!p) throw new Error(`Unknown provider: ${tuple.provider}`);
  return p.condense(tuple);
}
