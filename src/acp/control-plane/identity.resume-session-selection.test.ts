import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ACP runtime session identity resume selection', () => {
  it('prefers agentSessionId over acpxSessionId', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/acp/runtime/session-identity.ts'),
      'utf8',
    );

    expect(source).toContain(
      'normalizeText(identity.agentSessionId) ?? normalizeText(identity.acpxSessionId)',
    );
    expect(source).not.toContain(
      'normalizeText(identity.acpxSessionId) ?? normalizeText(identity.agentSessionId)',
    );
  });
});
