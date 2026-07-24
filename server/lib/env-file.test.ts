import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { upsertEnvContent, writeEnvKey } from './env-file.js';

describe('upsertEnvContent', () => {
  it('updates existing keys while preserving comments/order', () => {
    const input = [
      '# Header',
      'OPENAI_API_KEY=old',
      '',
      'REPLICATE_API_TOKEN=abc',
      '',
    ].join('\n');

    const out = upsertEnvContent(input, 'OPENAI_API_KEY', 'new');

    expect(out).toContain('# Header\n');
    expect(out).toContain('OPENAI_API_KEY=new\n');
    expect(out).toContain('REPLICATE_API_TOKEN=abc\n');
  });

  it('preserves CRLF line endings when present', () => {
    const input = 'FOO=1\r\nBAR=2\r\n';
    const out = upsertEnvContent(input, 'BAR', '9');

    expect(out).toBe('FOO=1\r\nBAR=9\r\n');
  });

  it('appends missing keys and ensures trailing newline', () => {
    const out = upsertEnvContent('FOO=1', 'BAR', '2');
    expect(out).toBe('FOO=1\nBAR=2\n');
  });

  it('rejects multi-line env values', () => {
    expect(() => upsertEnvContent('FOO=1\n', 'BAR', 'x\ny')).toThrow(
      'Invalid env value for BAR: multi-line values are not supported',
    );
  });
});

describe('writeEnvKey', () => {
  it('serializes concurrent writes to avoid lost updates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convosketchpad-env-test-'));
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(envPath, 'OPENAI_API_KEY=old\n', 'utf8');

    await Promise.all([
      writeEnvKey('OPENAI_API_KEY', 'new', envPath),
      writeEnvKey('REPLICATE_API_TOKEN', 'r8_xxx', envPath),
      writeEnvKey('EXAMPLE_SETTING', 'enabled', envPath),
    ]);

    const final = fs.readFileSync(envPath, 'utf8');
    expect(final).toContain('OPENAI_API_KEY=new\n');
    expect(final).toContain('REPLICATE_API_TOKEN=r8_xxx\n');
    expect(final).toContain('EXAMPLE_SETTING=enabled\n');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
