import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $insertNodes,
  $isElementNode,
  $isTextNode,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { File as FileIcon, Image as ImageIcon } from 'lucide-react';
import { canvasApi } from './api';
import { MAX_TURN_MATERIALS } from './constants';
import { upstreamReferenceCount } from './input-document';
import type {
  CanvasAttachmentMeta,
  CanvasDraftInputDocument,
  CanvasDraftInputReference,
  CanvasResourceCatalogItem,
} from './types';

type SerializedResourceTokenNode = SerializedLexicalNode & {
  reference: CanvasDraftInputReference;
};

class ResourceTokenNode extends DecoratorNode<ReactNode> {
  __reference: CanvasDraftInputReference;

  static getType(): string { return 'canvas-resource-token'; }

  static clone(node: ResourceTokenNode): ResourceTokenNode {
    return new ResourceTokenNode(node.__reference, node.__key);
  }

  static importJSON(serialized: SerializedResourceTokenNode): ResourceTokenNode {
    return new ResourceTokenNode(serialized.reference);
  }

  constructor(reference: CanvasDraftInputReference, key?: NodeKey) {
    super(key);
    this.__reference = reference;
  }

  createDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'inline-flex';
    return element;
  }

  updateDOM(): false { return false; }

  exportJSON(): SerializedResourceTokenNode {
    return { type: 'canvas-resource-token', version: 1, reference: this.__reference };
  }

  getTextContent(): string { return `@[${this.__reference.name || 'resource'}]`; }

  decorate(): ReactNode {
    return (
      <span
        contentEditable={false}
        className="mx-0.5 inline-flex max-w-48 items-center gap-1 rounded-md border border-primary/35 bg-primary/12 px-1.5 py-0.5 align-baseline text-xs font-medium text-primary"
        title={this.__reference.name || 'resource'}
      >
        @{this.__reference.name || 'resource'}
      </span>
    );
  }
}

function $createResourceTokenNode(reference: CanvasDraftInputReference): ResourceTokenNode {
  return new ResourceTokenNode(reference);
}

function $isResourceTokenNode(node: LexicalNode | null | undefined): node is ResourceTokenNode {
  return node instanceof ResourceTokenNode;
}

function populateEditor(documentValue: CanvasDraftInputDocument): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  const references = new Map(documentValue.references.map((reference) => [reference.key, reference]));
  for (const segment of documentValue.segments) {
    if (segment.type === 'text') paragraph.append($createTextNode(segment.text));
    else {
      const reference = references.get(segment.key);
      if (reference) paragraph.append($createResourceTokenNode(reference));
    }
  }
  root.append(paragraph);
  paragraph.selectEnd();
}

function appendNodeDocument(
  node: LexicalNode,
  segments: CanvasDraftInputDocument['segments'],
  references: Map<string, CanvasDraftInputReference>,
): void {
  if ($isTextNode(node)) {
    const text = node.getTextContent();
    if (text) segments.push({ type: 'text', text });
    return;
  }
  if ($isResourceTokenNode(node)) {
    const reference = node.__reference;
    segments.push({ type: 'resource', key: reference.key });
    references.set(reference.key, reference);
    return;
  }
  if ($isElementNode(node)) node.getChildren().forEach((child) => appendNodeDocument(child, segments, references));
}

function readEditorDocument(): CanvasDraftInputDocument {
  const segments: CanvasDraftInputDocument['segments'] = [];
  const references = new Map<string, CanvasDraftInputReference>();
  const children = $getRoot().getChildren();
  children.forEach((child, index) => {
    appendNodeDocument(child, segments, references);
    if (index < children.length - 1) segments.push({ type: 'text', text: '\n' });
  });
  return { version: 1, segments, references: [...references.values()] };
}

function sameReference(a: CanvasDraftInputReference, b: CanvasDraftInputReference): boolean {
  if (a.origin !== b.origin) return false;
  if (a.origin === 'draft_attachment' && b.origin === 'draft_attachment') {
    return a.draftAttachmentKey === b.draftAttachmentKey;
  }
  if (a.origin === 'current_turn_attachment' && b.origin === 'current_turn_attachment') {
    return a.attachmentId === b.attachmentId;
  }
  return a.origin === 'upstream' && b.origin === 'upstream'
    && a.sourceInteractionId === b.sourceInteractionId
    && a.kind === b.kind
    && a.resourceId === b.resourceId;
}

class ResourceOption extends MenuOption {
  reference: CanvasDraftInputReference;
  group: 'current' | 'upstream';
  selectable: boolean;
  thumbnailUri?: string;

  constructor(
    key: string,
    reference: CanvasDraftInputReference,
    group: ResourceOption['group'],
    selectable = true,
    thumbnailUri?: string,
  ) {
    super(key);
    this.reference = reference;
    this.group = group;
    this.selectable = selectable;
    this.thumbnailUri = thumbnailUri;
  }
}

function DocumentSyncPlugin({
  value,
  editorSignature,
}: {
  value: CanvasDraftInputDocument;
  editorSignature: MutableRefObject<string>;
}) {
  const [editor] = useLexicalComposerContext();
  const signature = JSON.stringify(value);
  useEffect(() => {
    if (editorSignature.current === signature) return;
    editorSignature.current = signature;
    editor.update(() => populateEditor(value));
  }, [editor, editorSignature, signature, value]);
  return null;
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return null;
}

function ResourceTypeaheadPlugin({
  branchId,
  documentValue,
  files,
  fileKeys,
  persistedAttachments,
  currentGroupLabel,
  upstreamGroupLabel,
}: {
  branchId: string;
  documentValue: CanvasDraftInputDocument;
  files: File[];
  fileKeys: string[];
  persistedAttachments: CanvasAttachmentMeta[];
  currentGroupLabel: string;
  upstreamGroupLabel: string;
}) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<CanvasResourceCatalogItem[]>([]);
  const trigger = useBasicTypeaheadTriggerMatch('@', { minLength: 0 });
  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void canvasApi.resources(branchId, query, controller.signal)
        .then(setUpstream)
        .catch(() => setUpstream([]));
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [branchId, query]);

  const options = useMemo(() => {
    const current: ResourceOption[] = [
      ...files.map((file, index) => new ResourceOption(
        `draft:${fileKeys[index]}`,
        {
          key: '',
          origin: 'draft_attachment',
          draftAttachmentKey: fileKeys[index],
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
        },
        'current',
      )),
      ...persistedAttachments.map((attachment) => new ResourceOption(
        `current:${attachment.id}`,
        {
          key: '',
          origin: 'current_turn_attachment',
          attachmentId: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
        },
        'current',
        true,
        attachment.thumbnailUri,
      )),
    ];
    const materialCount = files.length + persistedAttachments.length
      + upstreamReferenceCount(documentValue);
    const upstreamOptions = upstream.map((item) => {
      const reference: CanvasDraftInputReference = {
        key: '',
        ...item.reference,
        name: item.name,
        mimeType: item.mimeType,
      };
      const alreadySelected = documentValue.references.some((existing) =>
        sameReference(existing, reference));
      return new ResourceOption(
        `upstream:${item.reference.sourceInteractionId}:${item.reference.kind}:${item.reference.resourceId}`,
        reference,
        'upstream',
        item.selectable && (alreadySelected || materialCount < MAX_TURN_MATERIALS),
        item.thumbnailUri,
      );
    });
    return [...current, ...upstreamOptions];
  }, [documentValue, fileKeys, files, persistedAttachments, upstream]);

  return (
    <LexicalTypeaheadMenuPlugin<ResourceOption>
      triggerFn={trigger}
      onQueryChange={setQuery}
      options={options}
      onSelectOption={(option, queryNode, closeMenu) => {
        if (!option.selectable) return;
        editor.update(() => {
          const currentDocument = readEditorDocument();
          const existing = currentDocument.references.find((reference) =>
            sameReference(reference, option.reference));
          if (
            !existing
            && option.group === 'upstream'
            && files.length + persistedAttachments.length
              + upstreamReferenceCount(currentDocument) >= MAX_TURN_MATERIALS
          ) return;
          const reference = {
            ...option.reference,
            key: existing?.key || crypto.randomUUID(),
          } as CanvasDraftInputReference;
          queryNode?.remove();
          const token = $createResourceTokenNode(reference);
          $insertNodes([token, $createTextNode(' ')]);
          token.getNextSibling()?.selectEnd();
          closeMenu();
        });
      }}
      menuRenderFn={(anchorRef, {
        options: menuOptions,
        selectedIndex,
        selectOptionAndCleanUp,
        setHighlightedIndex,
      }) => anchorRef.current && menuOptions.length
          ? createPortal(
            <div className="absolute left-0 top-full z-[100] mt-1 max-h-72 min-w-72 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-2xl">
              {menuOptions.map((option, index) => (
                <button
                  key={option.key}
                  ref={option.setRefElement}
                  type="button"
                  role="option"
                  aria-selected={selectedIndex === index}
                  disabled={!option.selectable}
                  title={option.group === 'upstream'
                    ? `${upstreamGroupLabel}: ${'sourceInteractionId' in option.reference
                      ? option.reference.sourceInteractionId
                      : ''}`
                    : currentGroupLabel}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOptionAndCleanUp(option)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${selectedIndex === index ? 'bg-secondary' : ''} disabled:opacity-45`}
                >
                  {option.thumbnailUri
                    ? <img src={option.thumbnailUri} alt="" className="size-7 rounded object-cover" />
                    : option.reference.mimeType?.startsWith('image/')
                    ? <ImageIcon size={14} />
                    : <FileIcon size={14} />}
                  <span className="min-w-0 flex-1 truncate">{option.reference.name}</span>
                  <span className="text-[0.625rem] text-muted-foreground">
                    {option.group === 'current' ? currentGroupLabel : upstreamGroupLabel}
                  </span>
                </button>
              ))}
            </div>,
            anchorRef.current,
          )
          : null}
    />
  );
}

export function ResourceComposerEditor({
  branchId,
  value,
  files,
  fileKeys,
  persistedAttachments,
  disabled,
  placeholder,
  currentGroupLabel,
  upstreamGroupLabel,
  onChange,
  onFocus,
  onBlur,
}: {
  branchId: string;
  value: CanvasDraftInputDocument;
  files: File[];
  fileKeys: string[];
  persistedAttachments: CanvasAttachmentMeta[];
  disabled: boolean;
  placeholder: string;
  currentGroupLabel: string;
  upstreamGroupLabel: string;
  onChange: (value: CanvasDraftInputDocument) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const editorSignature = useRef(JSON.stringify(value));
  const [initialConfig] = useState(() => ({
    namespace: `canvas-composer-${branchId}`,
    nodes: [ResourceTokenNode],
    editable: !disabled,
    onError(error: Error) { throw error; },
    editorState: () => populateEditor(value),
    theme: { paragraph: 'm-0 min-h-5' },
  }));

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <RichTextPlugin
          contentEditable={(
            <ContentEditable
              onFocus={onFocus}
              onBlur={onBlur}
              aria-placeholder={placeholder}
              placeholder={(
                <div className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">
                  {placeholder}
                </div>
              )}
              className="nodrag nowheel min-h-28 w-full resize-none rounded-2xl border border-border bg-background/65 px-3 py-3 text-sm outline-none focus:border-primary"
            />
          )}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <OnChangePlugin onChange={(editorState) => {
          editorState.read(() => {
            const documentValue = readEditorDocument();
            editorSignature.current = JSON.stringify(documentValue);
            onChange(documentValue);
          });
        }} />
        <DocumentSyncPlugin value={value} editorSignature={editorSignature} />
        <EditablePlugin disabled={disabled} />
        <ResourceTypeaheadPlugin
          branchId={branchId}
          documentValue={value}
          files={files}
          fileKeys={fileKeys}
          persistedAttachments={persistedAttachments}
          currentGroupLabel={currentGroupLabel}
          upstreamGroupLabel={upstreamGroupLabel}
        />
      </div>
    </LexicalComposer>
  );
}
