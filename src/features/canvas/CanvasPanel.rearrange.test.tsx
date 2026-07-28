import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasFlowNode } from './CanvasNodes';
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
    instance: { fitView, getViewport, setViewport },
  };
});

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  graph: vi.fn(),
  agents: vi.fn(),
  createRoot: vi.fn(),
  saveLayout: vi.fn(),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  const React = await import('react');
  type MockReactFlowProps = {
    children?: ReactNode;
    nodes: CanvasFlowNode[];
    nodesDraggable?: boolean;
    onInit?: (instance: typeof flowMocks.instance) => void;
  };
  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    ReactFlow: ({ children, nodes, nodesDraggable, onInit }: MockReactFlowProps) => {
      flowMocks.lastNodes = nodes;
      flowMocks.lastNodesDraggable = nodesDraggable !== false;
      React.useEffect(() => {
        onInit?.(flowMocks.instance);
      }, [onInit]);
      return <div data-testid="react-flow">{children}</div>;
    },
  };
});

vi.mock('@/contexts/RuntimeContext', () => ({
  useRuntime: () => ({
    connectionState: 'connected',
    gatewayRestartSupported: true,
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
      agentId: 'main',
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
      sessionKey: 'agent:main:canvas:branch-1',
      openClawSessionId: 'session-1',
      observedSessionId: 'session-1',
      sessionIntegrity: 'healthy',
      sessionState: 'active',
      headInteractionId: 'interaction-1',
      createdAt: 1,
      updatedAt: 1,
    }],
    interactions: [{
      id: 'interaction-1',
      version: 1,
      branchId: 'branch-1',
      parentInteractionId: null,
      runId: 'run-1',
      userInput: 'hello',
      agentOutput: executionState === 'completed' ? 'done' : '',
      status: executionState === 'completed' ? 'completed' : 'streaming',
      executionState,
      artifactSyncState: executionState === 'completed' ? 'synced' : 'not_started',
      terminalAt: executionState === 'completed' ? 2 : null,
      error: null,
      attachments: [],
      artifacts: [],
      sessionMetadata: {},
      contextSnapshot: null,
      createdAt: 1,
      updatedAt: 1,
    }],
    layout: {
      nodes: {
        'interaction-1': { x: 800, y: 500 },
        'composer:branch-1:interaction-1': { x: 1_300, y: 500 },
      },
      viewport: { x: -120, y: -80, zoom: 0.7 },
    },
    pendingSends: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  apiMocks.list.mockResolvedValue([canvasGraph().canvas]);
  apiMocks.graph.mockResolvedValue(canvasGraph());
  apiMocks.agents.mockResolvedValue({ agents: [{ id: 'main' }] });
  apiMocks.saveLayout.mockResolvedValue(undefined);
  flowMocks.getViewport
    .mockReturnValueOnce({ x: -120, y: -80, zoom: 0.7 })
    .mockReturnValue({ x: 12, y: 24, zoom: 0.8 });
});

describe('Canvas rearrange action', () => {
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
        'interaction-1': expect.any(Object),
        'composer:branch-1:interaction-1': expect.any(Object),
      },
      viewport: { x: 12, y: 24, zoom: 0.8 },
    });

    finishSave();
    await waitFor(() => expect(screen.getByRole('button', { name: '重新排列' })).toBeEnabled());
    expect(flowMocks.lastNodesDraggable).toBe(true);
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
