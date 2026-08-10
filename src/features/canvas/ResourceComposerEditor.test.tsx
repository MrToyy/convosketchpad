import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResourceComposerEditor } from './ResourceComposerEditor';

const mocks = vi.hoisted(() => ({ resources: vi.fn().mockResolvedValue([]) }));

vi.mock('./api', () => ({
  canvasApi: { resources: mocks.resources },
}));

describe('ResourceComposerEditor', () => {
  it('renders a current draft attachment as an inline resource token on a root composer', () => {
    const file = new File(['image'], 'root-photo.png', { type: 'image/png' });
    render(
      <ResourceComposerEditor
        branchId="root-branch"
        value={{
          version: 1,
          segments: [
            { type: 'text', text: 'Describe ' },
            { type: 'resource', key: 'resource-1' },
            { type: 'text', text: ' here' },
          ],
          references: [{
            key: 'resource-1',
            origin: 'draft_attachment',
            draftAttachmentKey: 'draft-file',
            name: file.name,
            mimeType: file.type,
          }],
        }}
        files={[file]}
        fileKeys={['draft-file']}
        persistedAttachments={[]}
        disabled={false}
        placeholder="Write"
        currentGroupLabel="Current"
        upstreamGroupLabel="Upstream"
        onChange={vi.fn()}
        onFocus={vi.fn()}
        onBlur={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveTextContent('Describe @root-photo.png here');
  });
});
