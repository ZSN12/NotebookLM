import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';
import type { MindMapNode, MindMapData } from '@/services/api';

// ── Color mapping by node type ──
const TYPE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string; edge: string }> = {
  topic:      { bg: 'bg-purple-50 dark:bg-purple-900/30',  border: 'border-purple-300 dark:border-purple-700', text: 'text-purple-700 dark:text-purple-300', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-800 dark:text-purple-300', edge: '#9333ea' },
  concept:    { bg: 'bg-blue-50 dark:bg-blue-900/30',      border: 'border-blue-300 dark:border-blue-700',     text: 'text-blue-700 dark:text-blue-300',     badge: 'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300',     edge: '#2563eb' },
  key_point:  { bg: 'bg-green-50 dark:bg-green-900/30',    border: 'border-green-300 dark:border-green-700',   text: 'text-green-700 dark:text-green-300',   badge: 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300', edge: '#16a34a' },
  difficulty: { bg: 'bg-red-50 dark:bg-red-900/30',        border: 'border-red-300 dark:border-red-700',       text: 'text-red-700 dark:text-red-300',       badge: 'bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-300',         edge: '#dc2626' },
  example:    { bg: 'bg-amber-50 dark:bg-amber-900/30',    border: 'border-amber-300 dark:border-amber-700',   text: 'text-amber-700 dark:text-amber-300',   badge: 'bg-amber-100 text-amber-700 dark:bg-amber-800 dark:text-amber-300', edge: '#d97706' },
  conclusion: { bg: 'bg-slate-50 dark:bg-slate-800/50',    border: 'border-slate-300 dark:border-slate-600',   text: 'text-slate-700 dark:text-slate-300',   badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300', edge: '#64748b' },
};

const TYPE_LABELS: Record<string, string> = {
  topic: '主题', concept: '概念', key_point: '要点',
  difficulty: '难点', example: '示例', conclusion: '结论',
};

const IMPORTANCE_DOTS: Record<string, string> = {
  high: 'bg-red-400', medium: 'bg-amber-400', low: 'bg-slate-300',
};

// ── Custom node component ──
function MindMapCardNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as {
    label: string;
    nodeType: string;
    importance: string;
    hasChildren: boolean;
    isExpanded: boolean;
    isRoot: boolean;
  };

  const colors = TYPE_COLORS[nodeData.nodeType] || TYPE_COLORS.conclusion;
  const isRoot = nodeData.isRoot;

  return (
    <div
      className={`
        px-3 py-2 rounded-xl border-2 shadow-sm transition-all cursor-pointer
        ${colors.bg} ${colors.border}
        ${selected ? 'ring-2 ring-purple-400 shadow-md' : ''}
        ${isRoot ? 'px-5 py-3' : ''}
      `}
    >
      {/* Target handle (top or left) */}
      {!isRoot && <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-slate-300 !border-0" />}

      <div className="flex items-center gap-1.5">
        {nodeData.hasChildren && (
          <span className={`${colors.text} flex-shrink-0`}>
            {nodeData.isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${colors.badge}`}>
          {TYPE_LABELS[nodeData.nodeType] || nodeData.nodeType}
        </span>
        <span className={`${colors.text} ${isRoot ? 'text-base font-semibold' : 'text-sm font-medium'} truncate max-w-[180px]`}>
          {nodeData.label}
        </span>
        {nodeData.importance === 'high' && (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${IMPORTANCE_DOTS[nodeData.importance]}`} />
        )}
      </div>

      {/* Source handle (right or bottom) */}
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-slate-300 !border-0" />
    </div>
  );
}

const nodeTypes = { mindMapCard: MindMapCardNode };

// ── Layout algorithm: horizontal tree (XMind-like) ──
const H_GAP = 60;  // horizontal gap between levels
const V_GAP = 16;  // vertical gap between siblings

interface LayoutNode {
  id: string;
  width: number;
  height: number;
  children: LayoutNode[];
  x: number;
  y: number;
}

function estimateNodeSize(node: MindMapNode, isRoot: boolean): { w: number; h: number } {
  // Rough estimate based on title length
  const charWidth = isRoot ? 14 : 11;
  const padding = isRoot ? 80 : 70;
  const w = Math.max(120, Math.min(260, node.title.length * charWidth + padding));
  const h = isRoot ? 48 : 40;
  return { w, h };
}

function buildLayoutTree(nodes: MindMapNode[], expanded: Set<string>, isRoot: boolean): LayoutNode[] {
  return nodes.map(node => {
    const { w, h } = estimateNodeSize(node, isRoot);
    const children = (node.children?.length && expanded.has(node.id))
      ? buildLayoutTree(node.children, expanded, false)
      : [];
    return { id: node.id, width: w, height: h, children, x: 0, y: 0 };
  });
}

function layoutSubtree(node: LayoutNode): number {
  if (node.children.length === 0) return node.height;

  let totalChildHeight = 0;
  for (const child of node.children) {
    totalChildHeight += layoutSubtree(child);
  }
  totalChildHeight += (node.children.length - 1) * V_GAP;

  return Math.max(node.height, totalChildHeight);
}

function positionSubtree(node: LayoutNode, x: number, yCenter: number): void {
  node.x = x;
  node.y = yCenter - node.height / 2;

  if (node.children.length === 0) return;

  const childHeights = node.children.map(c => layoutSubtree(c));
  const totalHeight = childHeights.reduce((a, b) => a + b, 0) + (node.children.length - 1) * V_GAP;
  let currentY = yCenter - totalHeight / 2;

  for (let i = 0; i < node.children.length; i++) {
    const childCenter = currentY + childHeights[i] / 2;
    positionSubtree(node.children[i], x + node.width + H_GAP, childCenter);
    currentY += childHeights[i] + V_GAP;
  }
}

// ── Convert MindMapData to React Flow nodes/edges ──
function mindMapToFlow(
  data: MindMapData,
  expanded: Set<string>,
  onToggle: (id: string) => void,
  onSelect: (node: MindMapNode) => void,
): { nodes: Node[]; edges: Edge[] } {
  const flowNodes: Node[] = [];
  const flowEdges: Edge[] = [];

  // Flatten tree into layout nodes
  const layoutRoots = buildLayoutTree(data.nodes, expanded, false);

  // Build a virtual root for the center topic
  const rootSize = estimateNodeSize({ id: 'root', title: data.title, type: 'topic', importance: 'high' } as MindMapNode, true);
  const layoutRoot: LayoutNode = {
    id: 'root',
    width: rootSize.w,
    height: rootSize.h,
    children: layoutRoots,
    x: 0,
    y: 0,
  };

  // Position the tree
  layoutSubtree(layoutRoot);
  positionSubtree(layoutRoot, 0, 0);

  // Walk the layout tree and create flow nodes/edges
  function walk(layoutNode: LayoutNode, mindMapNode: MindMapNode | null, isRoot: boolean) {
    const colors = TYPE_COLORS[isRoot ? 'topic' : (mindMapNode?.type || 'conclusion')];

    flowNodes.push({
      id: layoutNode.id,
      type: 'mindMapCard',
      position: { x: layoutNode.x, y: layoutNode.y },
      data: {
        label: isRoot ? data.title : (mindMapNode?.title || ''),
        nodeType: isRoot ? 'topic' : (mindMapNode?.type || 'conclusion'),
        importance: isRoot ? 'high' : (mindMapNode?.importance || 'low'),
        hasChildren: isRoot ? data.nodes.length > 0 : (mindMapNode?.children?.length || 0) > 0,
        isExpanded: isRoot ? expanded.has(layoutNode.id) : expanded.has(layoutNode.id),
        isRoot,
        mindMapNodeId: layoutNode.id,
      } as any,
    });

    // Create edges to children
    for (let i = 0; i < layoutNode.children.length; i++) {
      const childLayout = layoutNode.children[i];
      const childMindMap = isRoot
        ? data.nodes[i]
        : mindMapNode?.children?.[i];

      flowEdges.push({
        id: `e-${layoutNode.id}-${childLayout.id}`,
        source: layoutNode.id,
        target: childLayout.id,
        type: 'smoothstep',
        style: { stroke: colors.edge, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: colors.edge },
      });

      walk(childLayout, childMindMap || null, false);
    }
  }

  walk(layoutRoot, null, true);
  return { nodes: flowNodes, edges: flowEdges };
}

// ── Main component ──
interface MindMapCanvasProps {
  data: MindMapData;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (node: MindMapNode) => void;
  selectedNode: MindMapNode | null;
  onSourceClick: (source: { source_type: string; page?: number | null; block_id?: string }) => void;
}

export default function MindMapCanvas({
  data,
  expanded,
  onToggle,
  onSelect,
  selectedNode,
  onSourceClick,
}: MindMapCanvasProps) {
  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => mindMapToFlow(data, expanded, onToggle, onSelect),
    [data, expanded],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Update nodes/edges when data changes
  useMemo(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [flowNodes, flowEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Find the MindMapNode by id
      const findNode = (nodes: MindMapNode[], id: string): MindMapNode | null => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if (n.children) {
            const found = findNode(n.children, id);
            if (found) return found;
          }
        }
        return null;
      };
      if (node.id === 'root') return;
      const mmNode = findNode(data.nodes, node.id);
      if (mmNode) onSelect(mmNode);
      onToggle(node.id);
    },
    [data.nodes, onSelect, onToggle],
  );

  return (
    <div className="flex h-full">
      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-slate-50 dark:bg-slate-900"
        >
          <Background color="#e2e8f0" gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Detail panel */}
      {selectedNode && (
        <div className="w-80 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-y-auto p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[selectedNode.type]?.badge || TYPE_COLORS.conclusion.badge}`}>
              {TYPE_LABELS[selectedNode.type] || selectedNode.type}
            </span>
            {selectedNode.importance && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                selectedNode.importance === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                selectedNode.importance === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
              }`}>
                {selectedNode.importance === 'high' ? '重要' : selectedNode.importance === 'medium' ? '一般' : '次要'}
              </span>
            )}
          </div>

          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-2">
            {selectedNode.title}
          </h3>

          {selectedNode.description && (
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
              {selectedNode.description}
            </p>
          )}

          {selectedNode.sources && selectedNode.sources.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                来源
              </h4>
              <div className="space-y-2">
                {selectedNode.sources.map((src, i) => (
                  <div
                    key={i}
                    className={`text-xs p-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 ${
                      src.source_type === 'ppt' && src.page != null ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700' : ''
                    }`}
                    onClick={() => onSourceClick(src)}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                        src.source_type === 'ppt' ? 'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300' :
                        src.source_type === 'transcript' ? 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300' :
                        'bg-slate-100 text-slate-600 dark:bg-slate-600 dark:text-slate-300'
                      }`}>
                        {src.source_type === 'ppt' ? 'PPT' : src.source_type === 'transcript' ? '转写' : '笔记'}
                      </span>
                      {src.page != null && (
                        <span className="text-blue-600 dark:text-blue-400 font-medium">
                          第 {src.page} 页
                        </span>
                      )}
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                      {src.snippet}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!selectedNode.description && (!selectedNode.sources || selectedNode.sources.length === 0) && (
            <p className="text-sm text-slate-400 dark:text-slate-500 italic">暂无详细说明</p>
          )}
        </div>
      )}
    </div>
  );
}
