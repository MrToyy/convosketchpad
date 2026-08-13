import { render, screen } from '@testing-library/react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourceComposerEditor } from './ResourceComposerEditor';
import { $replaceTypeaheadQuery } from './lexical-typeahead';

const mocks = vi.hoisted(() => ({ resources: vi.fn().mockResolvedValue({ items: [] }) }));

vi.mock('./api', () => ({
  canvasApi: { resources: mocks.resources },
}));

describe('ResourceComposerEditor', () => {
  beforeEach(() => {
    mocks.resources.mockReset().mockResolvedValue({ items: [] });
  });

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
        loadMoreLabel="Load more"
        resourceScopeRevision=""
        onChange={vi.fn()}
        onFocus={vi.fn()}
        onBlur={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveTextContent('Describe @root-photo.png here');
    expect(screen.getByTitle('root-photo.png')).toHaveClass(
      'max-w-36',
      'text-[0.6875rem]',
    );
  });

  it('replaces the typeahead query and moves selection after a trailing space', async () => {
    const editor = createEditor();
    editor.update(() => {
      const paragraph = $createParagraphNode();
      const query = $createTextNode('@0252');
      paragraph.append(query);
      $getRoot().append(paragraph);
      query.selectEnd();

      $replaceTypeaheadQuery(query, $createTextNode('@ig_0252-reference.png'));
    }, { discrete: true });

    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('@ig_0252-reference.png ');
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.isCollapsed()).toBe(true);
      expect(selection.anchor.offset).toBe('@ig_0252-reference.png '.length);
    });
  });
});
