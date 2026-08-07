import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeChange } from '@xyflow/react';
import type { CanvasFlowNode } from './flow-model';
import type { CanvasGraph } from './types';
import { CanvasPanel } from './CanvasPanel';

const flowMocks = vi.hoisted(() => {
  const fitView = vi.fn(async () => true);
  const getViewport = vi.fn(() => ({ x: 12, y: 24, zoom: 0.8 }));
  const setViewport = vi.fn(async () => true);
  return {
    fitView,
    getViewport,
    setViewport,
    lastNodes: [] as CanvasFlowNode[],
    lastNodesDraggable: true,
    onNodesChange: null as ((changes: NodeChange<CanvasFlowNode>[]) => void) | null,
    instance: { fitView, getViewport, setViewport },
  };
});

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  graph: vi.fn(),
  agents: vi.fn(),
  createRoot: vi.fn(),
  resubmit: vi.fn(),
  saveLayout: vi.fn(),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  const React = await import('react');
  type MockReactFlowProps = {
    children?: ReactNode;
    nodes: CanvasFlowNode[];
    nodesDraggable?: boolean;
    onNodesChange?: (changes: NodeChange<CanvasFlowNode>[]) => void;
    onInit?: (instance: typeof flowMocks.instance) => void;
  };
  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    ReactFlow: ({
      children,
      nodes,
      nodesDraggable,
      onNodesChange,
      onInit,
    }: MockReactFlowProps) => {
      flowMocks.lastNodes = nodes;
      flowMocks.lastNodesDraggable = nodesDraggable !== false;
      flowMocks.onNodesChange = onNodesChange || null;
      React.useEffect(() => {
        onInit?.(flowMocks.instance);
      }, [onInit]);
      return <div data-testid="react-flow">{children}</div>;
    },
  };
});

vi.mock('@/contexts/RuntimeContext', () => ({
  useRuntime: () => ({
    overallState: 'ready',
    runtimeStatuses: { openclaw: { runtimeId: 'openclaw', state: 'connected' } },
    connect: vi.fn(),
  }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ language: 'zh-CN' }),
}));

vi.mock('@/hooks/useCanvasSync', () => ({
  useCanvasSync: () => 'connected',
}));

vi.mock('./api', () => ({
  canvasApi: {
    list: apiMocks.list,
    graph: apiMocks.graph,
    agents: apiMocks.agents,
    createRoot: apiMocks.createRoot,
    resubmit: apiMocks.resubmit,
    saveLayout: apiMocks.saveLayout,
  },
  canvasArtifactUrl: (uri: string) => uri,
  persistCanvasFiles: vi.fn(),
}));

function canvasGraph(executionState: 'completed' | 'running' = 'completed'): CanvasGraph {
  return {
    cursor: 1,
    canvas: {
      id: 'canvas-1',
      name: 'Test Canvas',
      agentRef: { runtimeId: 'openclaw', profileId: 'main' },
      agentMutable: false,
      createdAt: 1,
      updatedAt: 1,
    },
    hasPendingUpdates: executionState === 'running',
    branches: [{
      id: 'branch-1',
      canvasId: 'canvas-1',
      kind: 'root',
      parentBranchId: null,
      forkedFromInteractionId: null,
      conversationId: 'agent:main:canvas:branch-1',
      conversationInstanceId: 'session-1',
      observedConversationInstanceId: 'session-1',
      conversationIntegrity: 'healthy',
      conversationState: 'active',
      creationMode: 'composer',
      headInteractionId: 'interaction-1',
      createdAt: 1,
      updatedAt: 1,
    }],
    interactions: [{
      id: 'interaction-1',
      version: 1,
      branchId: 'branch-1',
      parentInteractionId: null,
      runtimeTurnId: 'run-1',
      userInput: 'hello',
      agentOutput: executionState === 'completed' ? 'done' : '',
      status: executionState === 'completed' ? 'completed' : 'streaming',
      executionState,
      artifactSyncState: executionState === 'completed' ? 'synced' : 'not_started',
      terminalAt: executionState === 'completed' ? 2 : null,
      error: null,
      attachments: [],
      artifacts: [],
      approvals: [],
      executionMetadata: {},
      contextSnapshot: null,
      createdAt: 1,
      updatedAt: 1,
    }],
    layout: {
      nodes: {
        'interaction-1': { x: 800, y: 500, width: 640, height: 520 },
        'composer:branch-1:interaction-1': {
          x: 1_300,
          y: 500,
          width: 500,
          height: 480,
        },
      },
      viewport: { x: -120, y: -80, zoom: 0.7 },
    },
    pendingSends: [],
    failedSends: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  flowMocks.getViewport.mockReset();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  apiMocks.list.mockResolvedValue([canvasGraph().canvas]);
  apiMocks.graph.mockResolvedValue(canvasGraph());
  apiMocks.agents.mockResolvedValue({ agents: [{ agentRef: { runtimeId: 'openclaw', profileId: 'main' }, displayName: 'Main', runtimeDisplayName: 'OpenClaw', available: true }] });
  apiMocks.saveLayout.mockResolvedValue(undefined);
  apiMocks.resubmit.mockResolvedValue({});
  flowMocks.getViewport
    .mockReturnValueOnce({ x: -120, y: -80, zoom: 0.7 })
    .mockReturnValue({ x: 12, y: 24, zoom: 0.8 });
});

describe('Canvas rearrange action', () => {
  it('allows a running Interaction to be resubmitted without stopping the original node', async () => {
    apiMocks.graph.mockResolvedValue(canvasGraph('running'));
    render(<CanvasPanel />);
    await waitFor(() => expect(flowMocks.lastNodes.length).toBeGreaterThan(0));
    const interactionNode = flowMocks.lastNodes.find((node) => node.id === 'interaction-1');
    expect(interactionNode?.type).toBe('interaction');

    await act(async () => {
      if (interactionNode?.type === 'interaction') {
        interactionNode.data.onResubmit(interactionNode.data.interaction);
      }
    });

    await waitFor(() => expect(apiMocks.resubmit).toHaveBeenCalledWith('interaction-1', { runtimeId: 'openclaw', profileId: 'main' }));
    expect(apiMocks.graph).toHaveBeenCalled();
  });

  it('rearranges visible nodes, fits the viewport, and saves one complete layout', async () => {
    let finishSave!: () => void;
    apiMocks.saveLayout.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    render(<CanvasPanel />);

    const button = await screen.findByRole('button', { name: '重新排列' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByRole('button', { name: '排列中…' })).toBeDisabled();
    expect(flowMocks.lastNodesDraggable).toBe(false);
    await waitFor(() => expect(apiMocks.saveLayout).toHaveBeenCalledOnce());
    expect(flowMocks.fitView).toHaveBeenCalledWith({
      padding: 0.12,
      duration: 300,
      minZoom: 0.2,
      maxZoom: 1.5,
    });
    expect(apiMocks.saveLayout).toHaveBeenCalledWith('canvas-1', {
      nodes: {
        'interaction-1': expect.objectContaining({ width: 640, height: 520 }),
        'composer:branch-1:interaction-1': expect.objectContaining({
          width: 500,
          height: 480,
        }),
      },
      viewport: { x: 12, y: 24, zoom: 0.8 },
    });

    finishSave();
    await waitFor(() => expect(screen.getByRole('button', { name: '重新排列' })).toBeEnabled());
    expect(flowMocks.lastNodesDraggable).toBe(true);
  });

  it('persists manual dimensions without treating natural measurement as a custom size', async () => {
    render(<CanvasPanel />);
    await waitFor(() => expect(flowMocks.onNodesChange).not.toBeNull());
    apiMocks.saveLayout.mockClear();

    act(() => {
      flowMocks.onNodesChange?.([{
        id: 'interaction-1',
        type: 'dimensions',
        dimensions: { width: 650, height: 530 },
      }]);
    });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(apiMocks.saveLayout).not.toHaveBeenCalled();

    act(() => {
      flowMocks.onNodesChange?.([{
        id: 'interaction-1',
        type: 'dimensions',
        resizing: true,
        setAttributes: true,
        dimensions: { width: 700, height: 560 },
      }, {
        id: 'interaction-1',
        type: 'dimensions',
        resizing: false,
        dimensions: { width: 700, height: 560 },
      }]);
    });

    await waitFor(() => expect(apiMocks.saveLayout).toHaveBeenCalledWith(
      'canvas-1',
      expect.objectContaining({
        nodes: expect.objectContaining({
          'interaction-1': {
            x: 800,
            y: 500,
            width: 700,
            height: 560,
          },
        }),
      }),
    ), { timeout: 1_500 });
  });

  it('restores the previous nodes and viewport when persistence fails', async () => {
    apiMocks.saveLayout.mockRejectedValueOnce(new Error('save failed'));
    render(<CanvasPanel />);

    const button = await screen.findByRole('button', { name: '重新排列' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText('无法保存画布布局')).toBeInTheDocument();
    expect(flowMocks.setViewport).toHaveBeenCalledWith(
      { x: -120, y: -80, zoom: 0.7 },
      { duration: 150 },
    );
    expect(flowMocks.lastNodes.find((node) => node.id === 'interaction-1')?.position).toEqual({
      x: 800,
      y: 500,
    });
  });

  it('is disabled while an Interaction is running', async () => {
    apiMocks.graph.mockResolvedValue(canvasGraph('running'));
    render(<CanvasPanel />);

    const button = await screen.findByRole('button', { name: '重新排列' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      '请等待正在发送或生成的节点完成后再重新排列',
    );
  });
});
