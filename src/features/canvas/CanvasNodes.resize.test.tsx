import type { CSSProperties, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { canvasNodeTypes } from './node-types';
import { EMPTY_CANVAS_DRAFT } from './constants';

const { resolveApproval, connectionState } = vi.hoisted(() => ({
  resolveApproval: vi.fn(async () => ({})),
  connectionState: {
    inProgress: false,
    fromHandle: null as null | { id: string },
    fromNode: null as null | { id: string },
  },
}));
vi.mock('./api', () => ({
  canvasApi: { resolveApproval },
  canvasArtifactUrl: (uri: string) => uri,
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    Handle: ({
      children,
      id,
      type,
      position,
      isConnectable,
      isConnectableStart,
      isConnectableEnd,
      ...props
    }: {
      children?: ReactNode;
      id?: string | null;
      type: string;
      position: string;
      isConnectable?: boolean;
      isConnectableStart?: boolean;
      isConnectableEnd?: boolean;
      [key: string]: unknown;
    }) => (
      <div
        {...props}
        data-testid={`flow-handle-${id || type}`}
        data-position={position}
        data-connectable={String(isConnectable)}
        data-connectable-start={String(isConnectableStart)}
        data-connectable-end={String(isConnectableEnd)}
      >
        {children}
      </div>
    ),
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
    useConnection: (selector?: (state: typeof connectionState) => unknown) =>
      selector ? selector(connectionState) : connectionState,
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
  it('keeps a visible working indicator after streamed text appears', () => {
    const InteractionNode = canvasNodeTypes.interaction;
    const { rerender } = render(<InteractionNode
      {...commonNodeProps}
      id="interaction-streaming"
      type="interaction"
      data={{
        interaction: {
          id: 'interaction-streaming', version: 1, branchId: 'branch-1', parentInteractionId: null,
          userInput: 'hello', agentOutput: '', status: 'streaming', executionState: 'running',
          artifactSyncState: 'not_started', terminalAt: null, error: null, attachments: [], artifacts: [],
          approvals: [], executionMetadata: {}, contextSnapshot: null, createdAt: 1, updatedAt: 1,
        },
        preview: 'first streamed paragraph', composerOpen: false, canAdd: false,
        copying: false, resizeEnabled: true, onAdd: vi.fn(), onCopy: vi.fn(),
        onApprovalChanged: vi.fn(),
      }}
    />);

    expect(screen.getByText('first streamed paragraph')).toBeInTheDocument();
    const output = screen.getByTestId('interaction-output');
    const outputBody = screen.getByTestId('interaction-output-body');
    const workingStatus = screen.getByRole('status');
    expect(workingStatus).toHaveTextContent('智能体仍在工作…');
    expect(output).toHaveClass('flex', 'h-40', 'flex-col', 'overflow-hidden');
    expect(output).toHaveAttribute('aria-busy', 'true');
    expect(outputBody).toHaveClass('min-h-0', 'flex-1', 'overflow-y-scroll', 'overflow-x-hidden');
    expect(workingStatus).toHaveClass('shrink-0');
    expect(outputBody).not.toContainElement(workingStatus);

    Object.defineProperty(outputBody, 'scrollHeight', { configurable: true, value: 420 });
    outputBody.scrollTop = 0;
    rerender(<InteractionNode
      {...commonNodeProps}
      id="interaction-streaming"
      type="interaction"
      data={{
        interaction: {
          id: 'interaction-streaming', version: 1, branchId: 'branch-1', parentInteractionId: null,
          userInput: 'hello', agentOutput: '', status: 'streaming', executionState: 'running',
          artifactSyncState: 'not_started', terminalAt: null, error: null, attachments: [], artifacts: [],
          approvals: [], executionMetadata: {}, contextSnapshot: null, createdAt: 1, updatedAt: 2,
        },
        preview: 'first streamed paragraph\n\nsecond streamed paragraph', composerOpen: false, canAdd: false,
        copying: false, resizeEnabled: true, onAdd: vi.fn(), onCopy: vi.fn(),
        onApprovalChanged: vi.fn(),
      }}
    />);
    expect(outputBody.scrollTop).toBe(420);
  });

  it('always renders one bounded bottom-right handle for an Interaction', () => {
    const InteractionNode = canvasNodeTypes.interaction;
    const onOpenMergeTargets = vi.fn();
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
            agentRef: { runtimeId: 'openclaw', profileId: 'default' },
            runtimeTurnId: 'run-1',
            userInput: 'hello',
            agentOutput: 'done',
            status: 'completed',
            executionState: 'completed',
            artifactSyncState: 'synced',
            terminalAt: 1,
            error: null,
            attachments: [],
            artifacts: [],
            approvals: [],
            executionMetadata: {},
            contextSnapshot: null,
            createdAt: 1,
            updatedAt: 1,
          },
          preview: '',
          composerOpen: false,
          canAdd: false,
          copying: false,
          resizeEnabled: true,
          onAdd: vi.fn(),
          onCopy: vi.fn(),
          onOpenMergeTargets,
        }}
      />,
    );

    const mergeHandle = screen.getByTestId('flow-handle-merge-source');
    expect(mergeHandle).toHaveClass(
      '!flex',
      '!size-8',
      '!items-center',
      '!justify-center',
      '!rounded-full',
      '!border-primary/40',
      'hover:!bg-primary',
      'hover:!text-primary-foreground',
      '[&.connectingfrom]:!bg-primary',
      '[&.connectingfrom]:!text-primary-foreground',
    );
    expect(mergeHandle.className).not.toContain('ring-');
    expect(mergeHandle).toHaveAttribute('role', 'button');
    expect(mergeHandle).toHaveAttribute('aria-label', '拖动以将此已完成交互接入输入框');
    expect(mergeHandle).toHaveAttribute('aria-disabled', 'false');
    expect(mergeHandle).toHaveAttribute('data-position', 'right');
    expect(mergeHandle).toHaveAttribute('data-connectable', 'true');
    expect(mergeHandle).toHaveAttribute('data-connectable-start', 'true');
    expect(mergeHandle).toHaveAttribute('data-connectable-end', 'false');
    expect(mergeHandle.querySelector('.lucide-link-2')).toBeInTheDocument();
    fireEvent.click(mergeHandle);
    expect(onOpenMergeTargets).not.toHaveBeenCalled();
    fireEvent.keyDown(mergeHandle, { key: 'Enter' });
    expect(onOpenMergeTargets).toHaveBeenCalledOnce();

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
    expect(screen.getByTestId('interaction-output')).not.toHaveClass('h-40', 'overflow-hidden');
    expect(screen.getByTestId('interaction-output')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByTestId('interaction-output-body')).toHaveClass('max-h-[360px]', 'overflow-y-auto', 'overflow-x-hidden');
    const interactionAgent = screen.getByText('openclaw:default');
    expect(interactionAgent.closest('header')).toBeInTheDocument();
    expect(screen.getByText('已完成').nextElementSibling).toBe(interactionAgent);
    expect(screen.getByRole('button', { name: '复制：从上一节点创建可编辑的新输入框' })).toHaveClass(
      'size-8',
      'rounded-full',
      'border',
      'border-primary/40',
      'bg-background',
      'text-primary',
      'shadow-lg',
      'hover:bg-primary',
      'hover:text-primary-foreground',
    );

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
            runtimeTurnId: 'run-1',
            userInput: 'hello',
            agentOutput: 'done',
            status: 'completed',
            executionState: 'completed',
            artifactSyncState: 'synced',
            terminalAt: 1,
            error: null,
            attachments: [],
            artifacts: [],
            approvals: [],
            executionMetadata: {},
            contextSnapshot: null,
            createdAt: 1,
            updatedAt: 1,
          },
          preview: '',
          composerOpen: false,
          canAdd: false,
          copying: false,
          resizeEnabled: false,
          onAdd: vi.fn(),
          onCopy: vi.fn(),
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
    connectionState.inProgress = true;
    connectionState.fromHandle = { id: 'merge-source' };
    connectionState.fromNode = { id: 'interaction-source' };
    const composerData = {
      branch: {
        id: 'branch-1',
        canvasId: 'canvas-1',
        kind: 'root' as const,
        parentBranchId: null,
        forkedFromInteractionId: null,
        copiedFromInteractionId: null,
        activeAgentRef: null,
        conversationId: 'session-1',
        conversationInstanceId: null,
        observedConversationInstanceId: null,
        conversationIntegrity: 'unknown' as const,
        conversationState: 'draft' as const,
        creationMode: 'composer' as const,
        headInteractionId: null,
        createdAt: 1,
        updatedAt: 1,
      },
      draft: {
        ...EMPTY_CANVAS_DRAFT,
        agentRef: { runtimeId: 'openclaw', profileId: 'default' },
      },
      label: '新建主分支',
      agents: [{
        agentRef: { runtimeId: 'openclaw', profileId: 'default' },
        displayName: 'Main Agent',
        runtimeDisplayName: 'OpenClaw',
        available: true,
      }],
      onAgentChange: vi.fn(),
      resizeEnabled: true,
      onDocumentChange: vi.fn(),
      onFiles: vi.fn(),
      onRemoveFile: vi.fn(),
      onRemovePersistedAttachment: vi.fn(),
      onSend: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      resourceScopeRevision: 'merge-source-1',
    };
    const { container, rerender, unmount } = render(
      <ComposerNode
        {...commonNodeProps}
        id="composer:branch-1:root"
        type="composer"
        data={composerData}
      />,
    );

    expect(screen.getByTestId('node-resize-control')).toBeInTheDocument();
    const agentSelect = screen.getByRole('combobox', { name: '选择智能体' });
    expect(agentSelect).toHaveValue('openclaw:default');
    expect(screen.getByRole('option', { name: 'openclaw:default' })).toBeInTheDocument();
    expect(agentSelect.closest('header')).toBeInTheDocument();
    expect(agentSelect).toHaveClass(
      'border',
      'border-primary/40',
      'bg-primary/10',
      'appearance-none',
      'rounded-[8px]',
      'pl-2.5',
      'pr-8',
      'text-left',
      'text-sm',
      'font-semibold',
      'text-primary',
    );
    expect(agentSelect).not.toHaveClass('rounded-lg', 'rounded-md', 'text-right');
    expect(agentSelect.parentElement).not.toHaveClass('border', 'bg-background');
    const agentChevron = agentSelect.parentElement?.querySelector('.lucide-chevron-down');
    expect(agentChevron).toHaveClass('right-2.5');
    expect(container.querySelector('.lucide-bot')).not.toBeInTheDocument();
    expect(screen.queryByText('将完整回放当前分支，并在所选 Agent 中创建新会话。')).not.toBeInTheDocument();
    expect(screen.queryByText('已接入来源')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '定位到来源 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加附件' })).toHaveClass(
      '!border-primary/40',
      'text-primary',
      'hover:!border-primary/70',
    );
    expect(screen.getByRole('textbox')).toHaveClass('resize-none');
    expect(screen.getAllByTestId('node-resize-control')).toHaveLength(1);
    const mergeTarget = screen.getByTestId('flow-handle-merge-target');
    expect(mergeTarget).toHaveClass('!size-8', '!bg-primary', '!text-primary-foreground', 'shadow-lg');
    expect(mergeTarget.querySelector('.lucide-git-merge')).toBeInTheDocument();
    expect(mergeTarget.className).not.toContain('ring-');

    rerender(
      <ComposerNode
        {...commonNodeProps}
        id="composer:branch-1:interaction-source"
        type="composer"
        data={{
          ...composerData,
          branch: {
            ...composerData.branch,
            kind: 'fork',
            forkedFromInteractionId: 'interaction-source',
          },
        }}
      />,
    );
    expect(screen.getByTestId('flow-handle-merge-target')).toHaveClass('!size-3', 'shadow-none');
    expect(screen.getByTestId('flow-handle-merge-target')).toHaveAttribute('data-connectable', 'false');
    expect(screen.getByTestId('flow-handle-merge-target').querySelector('.lucide-git-merge')).not.toBeInTheDocument();

    rerender(
      <ComposerNode
        {...commonNodeProps}
        id="composer:branch-1:root"
        type="composer"
        data={{ ...composerData, draft: { ...EMPTY_CANVAS_DRAFT, sending: true } }}
      />,
    );
    expect(screen.getByTestId('flow-handle-merge-target')).toHaveClass('!size-3', 'shadow-none');
    expect(screen.getByTestId('flow-handle-merge-target').querySelector('.lucide-git-merge')).not.toBeInTheDocument();

    rerender(
      <ComposerNode
        {...commonNodeProps}
        id="composer:branch-1:root"
        type="composer"
        data={{ ...composerData, resizeEnabled: false }}
      />,
    );
    expect(screen.getByTestId('flow-handle-merge-target')).toHaveClass('!size-3', 'shadow-none');
    expect(screen.getByTestId('flow-handle-merge-target').querySelector('.lucide-git-merge')).not.toBeInTheDocument();
    unmount();
    connectionState.inProgress = false;
    connectionState.fromHandle = null;
    connectionState.fromNode = null;
  });

  it('renders approval controls inline on the Interaction and submits the selected permission scope', async () => {
    resolveApproval.mockClear();
    const onApprovalChanged = vi.fn();
    const InteractionNode = canvasNodeTypes.interaction;
    render(<InteractionNode
      {...commonNodeProps}
      id="interaction-approval"
      type="interaction"
      data={{
        interaction: {
          id: 'interaction-approval', version: 1, branchId: 'branch-1', parentInteractionId: null,
          userInput: 'run command', agentOutput: '', status: 'streaming', executionState: 'running',
          artifactSyncState: 'not_started', terminalAt: null, error: null, attachments: [], artifacts: [],
          executionMetadata: {}, contextSnapshot: null, createdAt: 1, updatedAt: 1,
          approvals: [{
            id: 'approval-1', category: 'command', title: 'Execute command', description: 'npm test',
            risk: 'high', permissions: [{ id: 'execute', label: 'Execute command', risk: 'high' }],
            choices: [
              { id: 'allow-once', intent: 'grant', scope: 'item', label: 'Allow once', requiresConfirmation: false },
              { id: 'allow-always', intent: 'grant', scope: 'persistent', label: 'Always allow', requiresConfirmation: true },
              { id: 'deny', intent: 'deny', scope: 'item', label: 'Deny', requiresConfirmation: false },
            ],
            expiresAt: null, status: 'pending', resolution: null, resolvedBy: null, resolvedAt: null,
            error: null, createdAt: 1, updatedAt: 1,
          }],
        },
        preview: '', composerOpen: false, canAdd: false, copying: false, resizeEnabled: true,
        onAdd: vi.fn(), onCopy: vi.fn(), onApprovalChanged,
      }}
    />);
    expect(screen.getByRole('region', { name: 'Execute command' })).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(resolveApproval).toHaveBeenCalledWith('approval-1', {
      choiceId: 'allow-once', grantedPermissionIds: ['execute'],
    }));
    expect(onApprovalChanged).toHaveBeenCalledOnce();

    resolveApproval.mockClear();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }));
    await waitFor(() => expect(resolveApproval).toHaveBeenCalledWith('approval-1', {
      choiceId: 'allow-always', grantedPermissionIds: ['execute'], confirmed: true,
    }));
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
});
