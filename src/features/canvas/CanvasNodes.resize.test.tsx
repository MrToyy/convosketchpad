import type { CSSProperties, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { canvasNodeTypes } from './CanvasNodes';
import { EMPTY_CANVAS_DRAFT } from './constants';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    Handle: () => null,
    NodeResizeControl: ({
      children,
      position,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      autoScale,
      style,
      className,
    }: {
      children?: ReactNode;
      position?: string;
      minWidth?: number;
      minHeight?: number;
      maxWidth?: number;
      maxHeight?: number;
      autoScale?: boolean;
      style?: CSSProperties;
      className?: string;
    }) => (
      <div
        data-testid="node-resize-control"
        data-position={position}
        data-min-width={minWidth}
        data-min-height={minHeight}
        data-max-width={maxWidth}
        data-max-height={maxHeight}
        data-auto-scale={String(autoScale)}
        data-class-name={className}
        style={style}
      >
        {children}
      </div>
    ),
  };
});

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ language: 'zh-CN' }),
}));

vi.mock('@/features/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@/features/chat/ImageLightbox', () => ({
  ImageLightbox: () => null,
}));

const commonNodeProps = {
  width: 380,
  height: 300,
  dragging: false,
  zIndex: 0,
  selectable: true,
  deletable: true,
  selected: false,
  draggable: true,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
};

describe('Canvas node resize controls', () => {
  it('always renders one bounded bottom-right handle for an Interaction', () => {
    const InteractionNode = canvasNodeTypes.interaction;
    const { rerender } = render(
      <InteractionNode
        {...commonNodeProps}
        id="interaction-1"
        type="interaction"
        data={{
          interaction: {
            id: 'interaction-1',
            version: 1,
            branchId: 'branch-1',
            parentInteractionId: null,
            runId: 'run-1',
            userInput: 'hello',
            agentOutput: 'done',
            status: 'completed',
            executionState: 'completed',
            artifactSyncState: 'synced',
            terminalAt: 1,
            error: null,
            attachments: [],
            artifacts: [],
            sessionMetadata: {},
            contextSnapshot: null,
            createdAt: 1,
            updatedAt: 1,
          },
          preview: '',
          composerOpen: false,
          canAdd: false,
          resubmitting: false,
          resizeEnabled: true,
          onAdd: vi.fn(),
          onResubmit: vi.fn(),
        }}
      />,
    );

    expect(screen.getByTestId('node-resize-control')).toHaveAttribute(
      'data-position',
      'bottom-right',
    );
    expect(screen.getByTestId('node-resize-control')).toHaveAttribute('data-min-width', '320');
    expect(screen.getByTestId('node-resize-control')).toHaveAttribute('data-min-height', '240');
    expect(screen.getByTestId('node-resize-control')).toHaveAttribute('data-max-width', '800');
    expect(screen.getByTestId('node-resize-control')).toHaveAttribute('data-max-height', '900');
    expect(screen.getByTestId('node-resize-control')).toHaveAttribute('data-auto-scale', 'false');
    expect(screen.getByTestId('node-resize-control')).toHaveStyle({
      left: 'auto',
      top: 'auto',
      right: '0px',
      bottom: '0px',
      width: '28px',
      height: '28px',
      translate: 'none',
      zIndex: '10',
    });
    expect(screen.getByTestId('node-resize-control')).toHaveAttribute(
      'data-class-name',
      expect.not.stringContaining('!bottom-1.5'),
    );
    expect(screen.getByTestId('node-resize-control')).toHaveAttribute(
      'data-class-name',
      expect.stringContaining('!bg-transparent'),
    );
    const grip = screen.getByTestId('node-resize-grip');
    expect(grip).toHaveClass('size-3.5', 'bottom-[5px]', 'right-[5px]');
    expect(Array.from(grip.querySelectorAll('path'), (path) => path.getAttribute('d'))).toEqual([
      'M2.75 13.25 13.25 2.75',
      'M7.25 13.25 13.25 7.25',
      'M11.25 13.25 13.25 11.25',
    ]);
    grip.querySelectorAll('path').forEach((path) => {
      expect(path).toHaveAttribute('stroke', 'currentColor');
      expect(path).toHaveAttribute('stroke-width', '1.5');
      expect(path).toHaveAttribute('stroke-linecap', 'round');
    });
    expect(screen.getByTitle('拖动调整节点大小')).toBeInTheDocument();

    rerender(
      <InteractionNode
        {...commonNodeProps}
        id="interaction-1"
        type="interaction"
        data={{
          interaction: {
            id: 'interaction-1',
            version: 1,
            branchId: 'branch-1',
            parentInteractionId: null,
            runId: 'run-1',
            userInput: 'hello',
            agentOutput: 'done',
            status: 'completed',
            executionState: 'completed',
            artifactSyncState: 'synced',
            terminalAt: 1,
            error: null,
            attachments: [],
            artifacts: [],
            sessionMetadata: {},
            contextSnapshot: null,
            createdAt: 1,
            updatedAt: 1,
          },
          preview: '',
          composerOpen: false,
          canAdd: false,
          resubmitting: false,
          resizeEnabled: false,
          onAdd: vi.fn(),
          onResubmit: vi.fn(),
        }}
      />,
    );
    expect(screen.getByTestId('node-resize-control')).toBeInTheDocument();
    expect(screen.getByTitle('拖动调整节点大小')).toHaveAttribute(
      'data-resize-enabled',
      'false',
    );
  });

  it('uses the same handle for a Composer and disables native textarea resizing', () => {
    const ComposerNode = canvasNodeTypes.composer;
    render(
      <ComposerNode
        {...commonNodeProps}
        id="composer:branch-1:root"
        type="composer"
        data={{
          branch: {
            id: 'branch-1',
            canvasId: 'canvas-1',
            kind: 'root',
            parentBranchId: null,
            forkedFromInteractionId: null,
            sessionKey: 'session-1',
            openClawSessionId: null,
            observedSessionId: null,
            sessionIntegrity: 'unknown',
            sessionState: 'draft',
            creationMode: 'composer',
            headInteractionId: null,
            createdAt: 1,
            updatedAt: 1,
          },
          draft: EMPTY_CANVAS_DRAFT,
          label: '新建主分支',
          resizeEnabled: true,
          onTextChange: vi.fn(),
          onFiles: vi.fn(),
          onRemoveFile: vi.fn(),
          onRemovePersistedAttachment: vi.fn(),
          onSend: vi.fn(),
          onFocus: vi.fn(),
          onBlur: vi.fn(),
        }}
      />,
    );

    expect(screen.getByTestId('node-resize-control')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveClass('resize-none');
    expect(screen.getAllByTestId('node-resize-control')).toHaveLength(1);
  });
});
