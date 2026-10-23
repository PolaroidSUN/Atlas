import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, BaseEdge, getSmoothStepPath, reconnectEdge,
  Handle, NodeResizer, Position, ReactFlow, useNodeId, useReactFlow, useUpdateNodeInternals, useViewport,
} from '@xyflow/react'
import { Extension } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowLeft, ArrowRight,
  Bold, BookOpen, Check, CheckSquare, ChevronDown, ChevronRight, Clock3, Code2,
  Command, Copy, ClipboardPaste, File, FileDown, FileImage, FileText, FileUp, Folder, FolderPlus,
  Heading1, Heading2, Highlighter, Image as ImageIcon, Italic, IndentDecrease,
  IndentIncrease, Link2, List, ListOrdered, MoreHorizontal, Moon, Network,
  PanelRightClose, PanelRightOpen, Pencil, Plus, Quote, Redo2, Search,
  Settings2, Strikethrough, Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
  Sun, Table2, Trash2, Underline as UnderlineIcon, Undo2, X, ZoomIn, Minus,
  Maximize2, MoveRight, Type, Map as MapIcon, House, FilePlus2, CheckCircle2, Palette,
  PanelTop, ExternalLink, Save, FilePlus, AlignVerticalSpaceAround, MousePointer2, Square, Layers3,
} from 'lucide-react'
import { normalizeCardImageMode, resizeCardImageFrame } from './features/canvas/card-image-model.js'
import { constrainCardImagePosition } from './features/canvas/card-image-gesture.js'
import { applyWrappedCardText, cardTextWrapExtension } from './features/canvas/card-text-wrap.js'
import { findCardImagePosition } from './features/canvas/card-image-flow.js'
import { buildCardImageContour } from './features/canvas/card-image-contour.js'
import { CreateDialog, InsertDocumentDialog, TableDialog } from './features/files/FileDialogs.jsx'

const STORAGE_KEY = 'atlas-alpha-workspace-v1'
const THEME_KEY = 'atlas-modular-lore-theme-v1'
const NodeOperationsContext = createContext({})
const TextStyleExtension = TextStyleKit.configure({ lineHeight: { types: ['paragraph', 'heading'] } })
const TextAlignmentExtension = TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] })
const ParagraphIndent = Extension.create({
  name: 'atlasParagraphIndent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        atlasIndent: {
          default: 0,
          parseHTML: element => Math.max(0, Math.min(8, Number(element.getAttribute('data-atlas-indent')) || 0)),
          renderHTML: attributes => {
            const level = Math.max(0, Math.min(8, Number(attributes.atlasIndent) || 0))
            return level ? { 'data-atlas-indent': String(level), style: `margin-left: ${level * 24}px` } : {}
          },
        },
      },
    }]
  },
  addCommands() {
    const changeIndent = delta => ({ state, tr, dispatch }) => {
      const { $from } = state.selection
      let depth = $from.depth
      while (depth > 0 && !['paragraph', 'heading'].includes($from.node(depth).type.name)) depth -= 1
      if (!depth) return false
      const node = $from.node(depth)
      const position = $from.before(depth)
      const atlasIndent = Math.max(0, Math.min(8, (Number(node.attrs.atlasIndent) || 0) + delta))
      if (atlasIndent === (Number(node.attrs.atlasIndent) || 0)) return true
      if (dispatch) dispatch(tr.setNodeMarkup(position, undefined, { ...node.attrs, atlasIndent }))
      return true
    }
    return {
      increaseParagraphIndent: () => changeIndent(1),
      decreaseParagraphIndent: () => changeIndent(-1),
    }
  },
})
const AtlasKeyboardShortcuts = Extension.create({
  name: 'atlasKeyboardShortcuts',
  addKeyboardShortcuts() {
    const editor = this.editor
    const sizes = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', '36pt', '48pt', '72pt']
    const adjustFontSize = direction => {
      const current = editor.getAttributes('textStyle').fontSize || '12pt'
      const currentIndex = Math.max(0, sizes.indexOf(current))
      const nextIndex = Math.max(0, Math.min(sizes.length - 1, currentIndex + direction))
      return editor.chain().focus().setFontSize(sizes[nextIndex]).run()
    }
    return {
      'Mod-a': () => { editor.commands.selectAll(); return true },
      'Mod-k': () => {
        const defaultURL = editor.getAttributes('link').href || 'https://'
        const url = window.prompt('Endereço do link (URL):', defaultURL)
        if (url?.trim()) editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
        return true
      },
      'Mod-Shift-x': () => editor.chain().focus().toggleStrike().run(),
      'Alt-Shift-5': () => editor.chain().focus().toggleStrike().run(),
      'Mod-Shift-7': () => editor.chain().focus().toggleOrderedList().run(),
      'Mod-Shift-8': () => editor.chain().focus().toggleBulletList().run(),
      'Mod-Shift-9': () => editor.chain().focus().toggleTaskList().run(),
      'Mod-Alt-0': () => editor.chain().focus().setParagraph().run(),
      'Mod-Alt-1': () => editor.chain().focus().setHeading({ level: 1 }).run(),
      'Mod-Alt-2': () => editor.chain().focus().setHeading({ level: 2 }).run(),
      'Mod-Alt-3': () => editor.chain().focus().setHeading({ level: 3 }).run(),
      'Mod-Shift-.': () => adjustFontSize(1),
      'Mod-Shift-,': () => adjustFontSize(-1),
    }
  },
})
const SharedTextExtensions = [TextStyleExtension, TextAlignmentExtension, Highlight.configure({ multicolor: true }), ParagraphIndent, Superscript, Subscript, AtlasKeyboardShortcuts]
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
const nowIso = () => new Date().toISOString()

// Shared model for every visual object in a canvas. React Flow receives the
// familiar node shape, while Atlas keeps type, geometry and content consistent.
class AtlasNode {
  constructor(type, position, data = {}, width = 280, height = 180) {
    this.id = makeId()
    this.type = type
    this.position = position
    this.data = data
    this.width = width
    this.height = height
  }
  toFlowNode() {
    // Explicit drag zones keep text editing separate from canvas movement. Image frames
    // use the whole image as their handle; editors remain `nodrag` for normal text selection.
    const dragHandleByType = { idea: '.idea-node-head', table: '.table-node-title', group: '.group-node-head', image: '.standalone-image', document: '.document-node-head' }
    return { id: this.id, type: this.type, position: this.position, data: this.data, style: { width: this.width, height: this.height }, dragHandle: dragHandleByType[this.type] || undefined }
  }
}
const makeAtlasNode = (type, position, data, width, height) => new AtlasNode(type, position, data, width, height).toFlowNode()

function createStarterMindMap() {
  // A balanced, center-first starter layout makes the first open canvas feel
  // like a mind map rather than a one-way flowchart.
  const root = makeAtlasNode('idea', { x: 0, y: 140 }, {
    title: 'Conceito central', text: 'A premissa que conecta personagens, lugares e conflitos.', richContent: '<p>A premissa que conecta personagens, lugares e conflitos.</p>', status: 'Em andamento', priority: 'Alta', tags: ['Premissa'],
  }, 320, 190)
  const branches = [
    makeAtlasNode('idea', { x: -440, y: 25 }, { title: 'Personagens e facções', text: 'Quem move a história e quais grupos disputam seus objetivos?', richContent: '<p>Quem move a história e quais grupos disputam seus objetivos?</p>', status: 'Em andamento', priority: 'Normal', tags: ['Personagem', 'Facção'] }, 270, 170),
    makeAtlasNode('idea', { x: -440, y: 285 }, { title: 'Lugares e referências', text: 'Cenários, culturas e imagens que dão identidade ao mundo.', richContent: '<p>Cenários, culturas e imagens que dão identidade ao mundo.</p>', status: 'Referência', priority: 'Normal', tags: ['Local', 'Referência'] }, 270, 170),
    makeAtlasNode('idea', { x: 440, y: 25 }, { title: 'Missões e conflitos', text: 'Objetivos, obstáculos, segredos e consequências.', richContent: '<p>Objetivos, obstáculos, segredos e consequências.</p>', status: 'Planejado', priority: 'Alta', tags: ['Missão', 'Conflito'] }, 270, 170),
    makeAtlasNode('idea', { x: 440, y: 285 }, { title: 'Notas e documentos', text: 'Detalhes longos, cronologia e documentos relacionados.', richContent: '<p>Detalhes longos, cronologia e documentos relacionados.</p>', status: 'Rascunho', priority: 'Normal', tags: ['Notas'] }, 270, 170),
  ]
  return {
    id: makeId(), type: 'canvas', name: 'Meu Lore Workspace', createdAt: nowIso(), updatedAt: nowIso(),
    nodes: [root, ...branches],
    edges: branches.map(node => {
      const onLeft = node.position.x < root.position.x
      return {
        id: makeId(), source: root.id, target: node.id,
        sourceHandle: onLeft ? 'left-out' : 'right-out',
        targetHandle: onLeft ? 'right-in' : 'left-in',
        type: 'smoothstep', selectable: true, deletable: true, interactionWidth: 28,
        style: { stroke: '#7d988b', strokeWidth: 2 },
      }
    }),
  }
}

const oppositeSide = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
function sideFromHandle(handleId) {
  const id = String(handleId || '').toLowerCase()
  if (/left|west|(^|[-_])w($|[-_])/.test(id)) return 'left'
  if (/right|east|(^|[-_])e($|[-_])/.test(id)) return 'right'
  if (/top|north|(^|[-_])n($|[-_])/.test(id)) return 'top'
  if (/bottom|south|down|(^|[-_])s($|[-_])/.test(id)) return 'bottom'
  return null
}
function inferEdgeSides(sourceNode, targetNode) {
  const nodeSize = node => ({
    width: Number(node?.width || node?.measured?.width || node?.style?.width) || ({ idea: 290, table: 390, image: 260, group: 300, document: 420 }[node?.type] || 280),
    height: Number(node?.height || node?.measured?.height || node?.style?.height) || ({ idea: 230, table: 270, image: 180, group: 220, document: 520 }[node?.type] || 180),
  })
  const ss = nodeSize(sourceNode), ts = nodeSize(targetNode)
  const sp = sourceNode?.position || { x: 0, y: 0 }, tp = targetNode?.position || { x: 0, y: 0 }
  const dx = (tp.x + ts.width / 2) - (sp.x + ss.width / 2)
  const dy = (tp.y + ts.height / 2) - (sp.y + ss.height / 2)
  const sourceSide = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
  return { sourceSide, targetSide: oppositeSide[sourceSide] }
}
function normalizeSavedEdges(edges, nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  return edges.map(edge => {
    const inferred = inferEdgeSides(byId.get(edge.source), byId.get(edge.target))
    const knownSourceSide = sideFromHandle(edge.sourceHandle)
    const knownTargetSide = sideFromHandle(edge.targetHandle)
    const sourceSide = knownSourceSide || (knownTargetSide ? oppositeSide[knownTargetSide] : inferred.sourceSide)
    const targetSide = knownTargetSide || oppositeSide[sourceSide]
    return {
      ...edge,
      sourceHandle: `${sourceSide}-out`,
      targetHandle: `${targetSide}-in`,
      type: 'smoothstep',
      reconnectable: true,
      interactionWidth: Math.max(18, Number(edge.interactionWidth) || 18),
      style: { stroke: '#7d988b', strokeWidth: 1.9, ...(edge.style || {}) },
    }
  })
}

function readItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function fileKind(type) {
  return ({ canvas: 'Canvas', doc: 'Documento', folder: 'Pasta', image: 'Imagem' })[type] || 'Arquivo'
}
function dateLabel(value) {
  if (!value) return 'Agora'
  const age = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(age) || age < 60_000) return 'Agora'
  if (age < 3_600_000) return `há ${Math.floor(age / 60_000)} min`
  if (age < 86_400_000) return `há ${Math.floor(age / 3_600_000)} h`
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

// Otimiza fotos grandes antes de gravá-las no workspace local. Mantém o arquivo
// original quando a conversão não ajuda e preserva formatos vetoriais/animados.
async function readImageForAtlas(file) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Arquivo de imagem inválido.')
  const type = String(file.type || '').toLowerCase()
  if (file.size <= 2_000_000 || type === 'image/svg+xml' || type === 'image/gif' || type === 'image/apng') {
    return readFileAsDataURL(file)
  }
  try {
    const bitmap = await createImageBitmap(file)
    const maxEdge = 2560
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) { bitmap.close?.(); return readFileAsDataURL(file) }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88))
    if (blob && blob.size > 0 && blob.size < file.size * 0.92) return readFileAsDataURL(blob)
  } catch { /* Codec indisponível: mantém o arquivo original. */ }
  return readFileAsDataURL(file)
}

// Keep image atoms out of copied text selections (Ctrl+A / Ctrl+C) while
// preserving the surrounding paragraphs, lists and other rich-text marks.
function stripImagesFromCopiedSlice(slice) {
  let changed = false
  const strip = fragment => {
    const children = []
    fragment.forEach(node => {
      if (node.type?.name === 'image') { changed = true; return }
      if (node.content?.size) {
        const content = strip(node.content)
        children.push(content === node.content ? node : node.copy(content))
      } else children.push(node)
    })
    return Fragment.fromArray(children)
  }
  const maxEdgeDepth = (fragment, fromEnd = false) => {
    let depth = 0, current = fragment
    while (current?.childCount) {
      const node = fromEnd ? current.lastChild : current.firstChild
      if (!node || node.isText || !node.content?.size) break
      depth += 1
      current = node.content
    }
    return depth
  }
  const content = strip(slice.content)
  if (!changed) return slice
  if (!content.childCount) return new Slice(Fragment.empty, 0, 0)
  return new Slice(content, Math.min(slice.openStart, maxEdgeDepth(content)), Math.min(slice.openEnd, maxEdgeDepth(content, true)))
}

function AtlasDropdownContent({ children, className = '', ...props }) {
  const classes = [...new Set(['atlas-menu-surface', 'menu-content', ...className.split(/\s+/).filter(token => token && token !== 'menu-content')])].join(' ')
  return <DropdownMenu.Portal><DropdownMenu.Content {...props} className={classes}>{children}</DropdownMenu.Content></DropdownMenu.Portal>
}

function AtlasSelect({ value, options, onChange, ariaLabel, title, className = '', disabled = false, prefix: Prefix }) {
  const selected = options.find(option => String(option.value) === String(value)) || options[0]
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className={`atlas-select-trigger ${className}`} aria-label={ariaLabel} title={title || ariaLabel} disabled={disabled} onMouseDown={event => event.preventDefault()}>
      {Prefix && <Prefix size={13} strokeWidth={1.8} />}<span>{selected?.label || 'Selecionar'}</span><ChevronDown size={11} />
    </button></DropdownMenu.Trigger>
    <AtlasDropdownContent className="atlas-select-menu" align="start" sideOffset={4} onCloseAutoFocus={event => event.preventDefault()}>
      {options.map(option => <DropdownMenu.Item key={String(option.value)} className={`menu-item atlas-select-item ${String(option.value) === String(value) ? 'active' : ''}`} onMouseDown={event => event.preventDefault()} onSelect={() => onChange(option.value)}>
        {option.icon && <option.icon size={14} strokeWidth={1.8} />}<span>{option.label}</span>{String(option.value) === String(value) && <Check size={13} className="atlas-select-check" />}
      </DropdownMenu.Item>)}
    </AtlasDropdownContent>
  </DropdownMenu.Root>
}

function AtlasColorPicker({ value, label, kind = 'text', disabled = false, onCommit }) {
  const initial = /^#[0-9a-f]{6}$/i.test(value || '') ? value : kind === 'highlight' ? '#fff09c' : '#26332f'
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(initial)
  const colorRef = useRef(initial)
  const frameRef = useRef(0)
  useEffect(() => {
    if (!open) { colorRef.current = initial; setDraft(initial) }
  }, [initial, open])
  useEffect(() => () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }, [])
  const setPreview = next => {
    colorRef.current = next
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; setDraft(colorRef.current) })
  }
  const commit = color => {
    const next = /^#[0-9a-f]{6}$/i.test(color || '') ? color : colorRef.current
    colorRef.current = next; setDraft(next); onCommit?.(next)
  }
  return <DropdownMenu.Root open={open} onOpenChange={next => { setOpen(next); if (next) { colorRef.current = initial; setDraft(initial) } }}>
    <DropdownMenu.Trigger asChild><button type="button" className={`format-color-picker-trigger ${kind === 'highlight' ? 'highlight' : ''}`} title={label} aria-label={label} disabled={disabled} onMouseDown={event => event.preventDefault()}>
      {kind === 'text' ? <span className="format-color-letter">A</span> : <Highlighter size={14} strokeWidth={1.8} />}<span className="format-color-swatch" style={{ backgroundColor: initial }} />
    </button></DropdownMenu.Trigger>
    <AtlasDropdownContent className="atlas-color-menu" align="start" sideOffset={5} onCloseAutoFocus={event => event.preventDefault()}>
      <div className="atlas-color-picker">
        <HexColorPicker color={draft} onChange={setPreview} onChangeEnd={color => commit(color)} aria-label={label} />
        <div className="atlas-color-input-row"><HexColorInput color={draft} onChange={setPreview} prefixed alpha={false} aria-label={`Valor ${label}`} /><span className="atlas-color-preview" style={{ backgroundColor: draft }} /></div>
        <button type="button" className="action-button primary atlas-color-apply" onMouseDown={event => event.preventDefault()} onClick={() => commit(colorRef.current)}>Aplicar</button>
      </div>
    </AtlasDropdownContent>
  </DropdownMenu.Root>
}

function FileIcon({ type, size = 16 }) {
  if (type === 'canvas') return <Network size={size} strokeWidth={1.7} />
  if (type === 'folder') return <Folder size={size} strokeWidth={1.7} />
  if (type === 'image') return <FileImage size={size} strokeWidth={1.7} />
  return <FileText size={size} strokeWidth={1.7} />
}
function ActionButton({ children, icon: Icon, variant = 'quiet', className = '', ...props }) {
  return <button className={`action-button ${variant} ${className}`} {...props}>{Icon && <Icon size={15} strokeWidth={1.8} />}{children}</button>
}

function SidebarFile({ item, active, onOpen, onRename, onDelete, onDuplicate, onMove, onDropToFolder }) {
  const isFolder = item.type === 'folder'
  return <div className={`sidebar-file ${active ? 'active' : ''} ${item.parentId ? 'nested' : ''} ${isFolder ? 'folder-target' : ''}`} data-item-id={item.id}
    draggable={!isFolder}
    onDragStart={event => { if (!isFolder) { event.dataTransfer.setData('text/atlas-item', item.id); event.dataTransfer.effectAllowed = 'move' } }}
    onDragOver={event => { if (isFolder) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
    onDrop={event => { if (!isFolder) return; event.preventDefault(); event.stopPropagation(); const movedId = event.dataTransfer.getData('text/atlas-item'); if (movedId) onDropToFolder(movedId, item.id) }}>
    <button className="sidebar-file-main" onClick={() => onOpen(item.id)} title={item.name}><span className={`sidebar-file-icon ${item.type}`}><FileIcon type={item.type} size={15} /></span><span className="sidebar-file-name">{item.name}</span></button>
    <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="sidebar-file-menu icon-button" aria-label={`Opções de ${item.name}`} onClick={e => e.stopPropagation()}><MoreHorizontal size={15} /></button></DropdownMenu.Trigger>
      <AtlasDropdownContent className="menu-content" side="left" align="start" sideOffset={7}>
        <DropdownMenu.Item className="menu-item" onSelect={() => onRename(item)}><Settings2 size={14} /> Renomear</DropdownMenu.Item>
        <DropdownMenu.Item className="menu-item" onSelect={() => onDuplicate(item)}><Copy size={14} /> Duplicar</DropdownMenu.Item>
        <DropdownMenu.Item className="menu-item" onSelect={() => onMove(item)}><MoveRight size={14} /> Mover para pasta…</DropdownMenu.Item>
        <DropdownMenu.Separator className="menu-separator" />
        <DropdownMenu.Item className="menu-item danger" onSelect={() => onDelete(item)}><Trash2 size={14} /> Excluir</DropdownMenu.Item>
      </AtlasDropdownContent>
    </DropdownMenu.Root>
  </div>
}

function MoveDialog({ item, folders, open, onOpenChange, onMove }) {
  const [destination, setDestination] = useState(item?.parentId || '')
  useEffect(() => { if (open) setDestination(item?.parentId || '') }, [open, item?.id, item?.parentId])
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content">
    <div className="dialog-heading"><div><Dialog.Title className="dialog-title">Mover arquivo</Dialog.Title><Dialog.Description className="dialog-description">Escolha uma pasta ou deixe na raiz.</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Fechar"><X size={16} /></button></Dialog.Close></div>
    <label className="field-label">Destino</label><AtlasSelect ariaLabel="Destino da pasta" className="move-destination-select" value={destination} onChange={setDestination} options={[{ value: '', label: 'Espaço de trabalho' }, ...folders.filter(folder => folder.id !== item?.id).map(folder => ({ value: folder.id, label: folder.name }))]} />
    <div className="dialog-footer"><Dialog.Close asChild><button className="action-button quiet">Cancelar</button></Dialog.Close><button className="action-button primary" onClick={() => { onMove(item, destination || null); onOpenChange(false) }}>Mover</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}

function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', destructive = false, onConfirm }) {
  const confirm = () => { onConfirm?.(); onOpenChange(false) }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content confirm-dialog">
        <div className="dialog-heading"><div><Dialog.Title className="dialog-title">{title}</Dialog.Title><Dialog.Description className="dialog-description">{description}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="Fechar"><X size={16} /></button></Dialog.Close></div>
        <div className="dialog-footer"><Dialog.Close asChild><button type="button" className="action-button quiet">{cancelLabel}</button></Dialog.Close><button type="button" className={`action-button ${destructive ? 'destructive' : 'primary'}`} onClick={confirm}>{confirmLabel}</button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

function ConnectionPorts() {
  const { zoom = 1 } = useViewport()
  const nodeId = useNodeId()
  const updateNodeInternals = useUpdateNodeInternals()
  const safeZoom = Math.max(zoom, 0.05)
  useEffect(() => {
    if (!nodeId) return
    const update = () => updateNodeInternals(nodeId)
    const frame = requestAnimationFrame(update)
    const nodeElement = document.querySelector(`.react-flow__node[data-id="${nodeId}"] .atlas-node`)
    const observer = typeof ResizeObserver !== 'undefined' && nodeElement ? new ResizeObserver(update) : null
    if (observer && nodeElement) observer.observe(nodeElement)
    return () => { cancelAnimationFrame(frame); observer?.disconnect() }
  }, [nodeId, zoom, updateNodeInternals])

  // Connection targets stay in the middle of each side. The edges and corners
  // belong to the resizer, so dragging a border stretches the shape instead of
  // starting a link. Source zones sit just outside the border, targets just inside.
  const depth = 18 / safeZoom
  const span = 36 / safeZoom
  const common = {
    opacity: 0, pointerEvents: 'all', background: 'transparent', border: 0,
    borderColor: 'transparent', boxShadow: 'none',
  }
  const handleStyle = (side, direction) => {
    const style = { ...common }
    const outside = direction > 0
    if (side === 'top') Object.assign(style, { left: '50%', width: `${span}px`, height: `${depth}px`, top: outside ? `${-depth}px` : '0px', transform: 'translateX(-50%)' })
    if (side === 'bottom') Object.assign(style, { left: '50%', width: `${span}px`, height: `${depth}px`, bottom: outside ? `${-depth}px` : '0px', transform: 'translateX(-50%)' })
    if (side === 'left') Object.assign(style, { top: '50%', width: `${depth}px`, height: `${span}px`, left: outside ? `${-depth}px` : '0px', transform: 'translateY(-50%)' })
    if (side === 'right') Object.assign(style, { top: '50%', width: `${depth}px`, height: `${span}px`, right: outside ? `${-depth}px` : '0px', transform: 'translateY(-50%)' })
    return style
  }
  const visualSize = 14 / safeZoom
  const visibleStyle = side => {
    const style = { width: `${visualSize}px`, height: `${visualSize}px`, borderWidth: `${1.5 / safeZoom}px`, '--canvas-zoom': zoom }
    if (side === 'top') Object.assign(style, { top: 0, left: '50%', transform: 'translate(-50%, -50%)' })
    if (side === 'bottom') Object.assign(style, { bottom: 0, left: '50%', transform: 'translate(-50%, 50%)' })
    if (side === 'left') Object.assign(style, { left: 0, top: '50%', transform: 'translate(-50%, -50%)' })
    if (side === 'right') Object.assign(style, { right: 0, top: '50%', transform: 'translate(50%, -50%)' })
    return style
  }
  return <>
    <Handle type="target" position={Position.Top} id="top-in" className="port top-in" style={handleStyle('top', -1)} />
    <Handle type="source" position={Position.Top} id="top-out" className="port top-out" style={handleStyle('top', 1)} />
    <Handle type="target" position={Position.Right} id="right-in" className="port right-in" style={handleStyle('right', -1)} />
    <Handle type="source" position={Position.Right} id="right-out" className="port right-out" style={handleStyle('right', 1)} />
    <Handle type="target" position={Position.Bottom} id="bottom-in" className="port bottom-in" style={handleStyle('bottom', -1)} />
    <Handle type="source" position={Position.Bottom} id="bottom-out" className="port bottom-out" style={handleStyle('bottom', 1)} />
    <Handle type="target" position={Position.Left} id="left-in" className="port left-in" style={handleStyle('left', -1)} />
    <Handle type="source" position={Position.Left} id="left-out" className="port left-out" style={handleStyle('left', 1)} />
    {['top', 'right', 'bottom', 'left'].map(side => <span key={side} aria-hidden="true" className={`atlas-visible-port port-${side}`} style={visibleStyle(side)} />)}
  </>
}

function CenteredConnectionEdge(props) {
  const { getNode } = useReactFlow()
  const sourceNode = getNode(props.source)
  const targetNode = getNode(props.target)
  const getBounds = node => {
    if (!node) return null
    const position = node.positionAbsolute || node.position || { x: 0, y: 0 }
    const styleWidth = Number.parseFloat(node.style?.width)
    const styleHeight = Number.parseFloat(node.style?.height)
    return {
      x: Number(position.x) || 0,
      y: Number(position.y) || 0,
      width: Number(node.measured?.width || node.width || styleWidth) || 260,
      height: Number(node.measured?.height || node.height || styleHeight) || 180,
    }
  }
  const anchor = (node, side, fallbackX, fallbackY) => {
    const bounds = getBounds(node)
    if (!bounds) return { x: fallbackX, y: fallbackY }
    if (side === Position.Top) return { x: bounds.x + bounds.width / 2, y: bounds.y }
    if (side === Position.Right) return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
    if (side === Position.Bottom) return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }
    return { x: bounds.x, y: bounds.y + bounds.height / 2 }
  }
  const source = anchor(sourceNode, props.sourcePosition, props.sourceX, props.sourceY)
  const target = anchor(targetNode, props.targetPosition, props.targetX, props.targetY)
  const [path] = getSmoothStepPath({
    sourceX: source.x, sourceY: source.y, sourcePosition: props.sourcePosition,
    targetX: target.x, targetY: target.y, targetPosition: props.targetPosition,
    borderRadius: 0, offset: 22,
  })
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} markerStart={props.markerStart} style={{ ...(props.style || {}), strokeLinecap: 'butt', strokeLinejoin: 'miter' }} interactionWidth={props.interactionWidth} />
}

function HoverNodeResizer({ hovered, zoom = 1, minWidth = 180, minHeight = 120, maxWidth, maxHeight }) {
  const [resizing, setResizing] = useState(false)
  const safeZoom = Math.max(Number(zoom) || 1, 0.05)
  return <NodeResizer
    isVisible={hovered || resizing}
    onResizeStart={() => setResizing(true)}
    onResizeEnd={() => setResizing(false)}
    autoScale
    minWidth={minWidth}
    minHeight={minHeight}
    {...(maxWidth ? { maxWidth } : {})}
    {...(maxHeight ? { maxHeight } : {})}
    color="transparent"
    handleStyle={{ width: 10, height: 10, opacity: 0, pointerEvents: 'all', border: 0, borderRadius: 0, background: 'transparent', boxShadow: 'none' }}
    lineStyle={{ borderStyle: 'solid', borderColor: 'transparent', borderWidth: `${4.5 / safeZoom}px`, opacity: 0, pointerEvents: 'all', background: 'transparent' }}
  />
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}
function buildInitialCardHTML(data) {
  if (typeof data.richContent === 'string') return data.richContent || '<p></p>'
  const oldImages = [...(Array.isArray(data.images) ? data.images : [])].sort((a, b) => (a.y || 0) - (b.y || 0))
  const imageHTML = oldImages.map(image => {
    const align = (Number(image.x) || 0) > 130 ? 'right' : 'left'
    const widthPct = Math.max(18, Math.min(78, Math.round(((Number(image.w) || 132) / 270) * 100)))
    return `<img src="${escapeHTML(image.src)}" alt="${escapeHTML(image.name || 'Imagem')}" data-card-align="${align}" data-width-pct="${widthPct}" data-frame-height="${Math.max(44, Number(image.h) || 82)}" data-object-fit="${escapeHTML(image.fit || 'contain')}" data-natural-width="${Number(image.naturalWidth) || 160}" data-natural-height="${Number(image.naturalHeight) || 100}" />`
  }).join('')
  const text = String(data.text || '')
  const textHTML = text.split(/\n{2,}/).map(part => `<p>${escapeHTML(part).replace(/\n/g, '<br>') || '<br>'}</p>`).join('')
  return `${imageHTML}${textHTML || '<p></p>'}`
}

function getCardVisibleBounds(editor) {
  const view = editor?.view
  const body = view?.dom?.closest('.idea-node-body')
  return (body || view?.dom)?.getBoundingClientRect?.() || null
}

// Free-positioned images use editor-local absolute coordinates. Pretext then
// fills every free slot on each line, including both sides of an image that
// sits in the middle. A CSS float can only open one edge.
function applyCardImageTextFlow(editor, zoom = 1) {
  const safeZoom = Math.max(0.05, Number(zoom) || 1)
  const root = editor?.view?.dom
  if (!root) return

  // Remove the previous flow's generated minimum before measuring natural
  // content. Otherwise the card's old height becomes the editor's new content
  // height, which can trigger a feedback loop that keeps growing the card.
  root.style.minHeight = '0px'
  const editorRect = root.getBoundingClientRect()
  const images = [...root.querySelectorAll('.card-image-node')]
  const blocks = [...root.querySelectorAll('p,h1,h2,h3,blockquote,pre,ul,ol,table')]
    .filter(block => !block.closest('.card-image-node'))
  for (const block of blocks) {
    if (!block.hasAttribute('data-atlas-base-margin-left')) {
      block.setAttribute('data-atlas-base-margin-left', block.style.marginLeft || '')
      block.setAttribute('data-atlas-base-margin-right', block.style.marginRight || '')
    }
    block.style.marginLeft = block.getAttribute('data-atlas-base-margin-left') || ''
    block.style.marginRight = block.getAttribute('data-atlas-base-margin-right') || ''
  }

  let imageBottom = 0
  for (const image of images) {
    const rect = image.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) continue
    const localBottom = Math.max(0, (rect.bottom - editorRect.top) / safeZoom)
    imageBottom = Math.max(imageBottom, localBottom + 18)
  }
  // Pretext fills every free slot on a line, so an image in the center has
  // text on both sides. A CSS float can only open the left or the right edge.
  applyWrappedCardText(editor, zoom)

  // Absolute image frames do not participate in document flow, so calculate
  // their lower edge explicitly and let the editor grow only to natural text /
  // image content, never to the card's previous body height.
  const naturalContentBottom = [...root.children].reduce((bottom, child) => {
    if (child.classList?.contains('atlas-text-wrap')) return bottom
    const rect = child.getBoundingClientRect()
    return Math.max(bottom, Math.max(0, (rect.bottom - editorRect.top) / safeZoom))
  }, root.scrollHeight || 0)
  root.style.minHeight = `${Math.ceil(Math.max(naturalContentBottom, imageBottom))}px`
}

const cardImageFlowFrames = new WeakMap()
function scheduleCardImageTextFlow(editor, zoom = 1) {
  if (!editor?.view || editor.isDestroyed || cardImageFlowFrames.has(editor)) return
  const frame = requestAnimationFrame(() => {
    cardImageFlowFrames.delete(editor)
    if (editor && !editor.isDestroyed) applyCardImageTextFlow(editor, zoom)
  })
  cardImageFlowFrames.set(editor, frame)
}

function countImagesWithSameSource(editor, src) {
  if (!editor || !src) return 0
  let count = 0
  editor.state.doc.descendants(candidate => {
    if (candidate.type.name === 'image' && candidate.attrs.src === src) count += 1
  })
  return count
}

function ImageContextMenu({ position, actions, onClose, ariaLabel = 'Menu de contexto' }) {
  const menuRef = useRef(null)
  useEffect(() => {
    if (!position) return
    const onPointerDown = event => { if (!menuRef.current?.contains(event.target)) onClose() }
    const onKeyDown = event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    const onScroll = () => onClose()
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [position, onClose])
  if (!position || typeof document === 'undefined') return null
  const left = Math.max(8, Math.min(position.x, window.innerWidth - 230))
  const top = Math.max(8, Math.min(position.y, window.innerHeight - 340))
  return createPortal(<div ref={menuRef} className="atlas-menu-surface menu-content image-context-menu" role="menu" aria-label={ariaLabel} style={{ left, top }} onPointerDown={event => event.stopPropagation()}>
    {actions.map((action, index) => action.separator
      ? <div key={`separator-${index}`} className="image-context-separator" role="separator" />
      : <button key={action.label} type="button" role="menuitem" disabled={Boolean(action.disabled)} className={`menu-item image-context-item ${action.danger ? 'danger' : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => { if (!action.disabled) action.onSelect(); onClose() }}>
          {action.icon && <action.icon size={14} strokeWidth={1.8} />}<span>{action.label}</span>
        </button>)}
  </div>, document.body)
}

function clampAtlas(value, min, max) {
  const number = Number(value)
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min))
}

// Return the nearest edge (or corner) to the pointer. Ctrl+drag transforms the
// image frame; Alt+drag crops the image like OBS. No mode buttons are required.
function imageEdgeFromPoint(event, rect) {
  // The canvas zoom shrinks the picture on screen. The edge band stays a
  // fraction of that box so the middle can still be dragged.
  const smaller = Math.min(rect.width, rect.height)
  const pad = Math.min(16, smaller * 0.22)
  const distances = {
    w: Math.abs(event.clientX - rect.left),
    e: Math.abs(rect.right - event.clientX),
    n: Math.abs(event.clientY - rect.top),
    s: Math.abs(rect.bottom - event.clientY),
  }
  const horizontal = distances.w <= pad ? 'w' : distances.e <= pad ? 'e' : ''
  const vertical = distances.n <= pad ? 'n' : distances.s <= pad ? 's' : ''
  if (horizontal || vertical) return `${vertical}${horizontal}`
  const nearest = Object.entries(distances).sort((a, b) => a[1] - b[1])[0]
  return nearest && nearest[1] <= pad ? nearest[0] : null
}

function cropImageStyle(left, top, right, bottom, objectFit = 'contain') {
  const cropWidth = Math.max(10, 100 - left - right)
  const cropHeight = Math.max(10, 100 - top - bottom)
  return {
    position: 'absolute', left: `${-(left / cropWidth) * 100}%`, top: `${-(top / cropHeight) * 100}%`,
    width: `${(100 / cropWidth) * 100}%`, height: `${(100 / cropHeight) * 100}%`,
    maxWidth: 'none', maxHeight: 'none', display: 'block', objectFit, pointerEvents: 'auto',
  }
}

function CardImageNodeView({ node, updateAttributes, selected, deleteNode, editor, getPos }) {
  const { zoom = 1 } = useViewport()
  const wrapperRef = useRef(null)
  const gestureRef = useRef(null)
  const listenersRef = useRef(null)
  const startMoveRef = useRef(null)
  const [imageSelected, setImageSelected] = useState(false)
  const [imageHovered, setImageHovered] = useState(false)
  const [contour, setContour] = useState(null)
  const [contextPosition, setContextPosition] = useState(null)
  const closeContextMenu = useCallback(() => setContextPosition(null), [])
  const safeZoom = Math.max(Number(zoom) || 1, 0.05)
  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return
    const onContextMenu = event => {
      event.preventDefault(); event.stopPropagation()
      setContextPosition({ x: event.clientX, y: event.clientY })
    }
    element.addEventListener('contextmenu', onContextMenu)
    return () => element.removeEventListener('contextmenu', onContextMenu)
  }, [editor, getPos])
  useEffect(() => {
    const syncSelection = () => {
      let position
      try { position = typeof getPos === 'function' ? getPos() : null } catch { return }
      setImageSelected(Number.isInteger(position) && editor.state.selection instanceof NodeSelection && editor.state.selection.from === position)
    }
    editor.on('selectionUpdate', syncSelection)
    return () => editor.off('selectionUpdate', syncSelection)
  }, [editor, getPos])
  const align = node.attrs.align === 'right' ? 'right' : node.attrs.align === 'center' ? 'center' : 'left'
  const widthPct = Math.max(8, Math.min(96, Number(node.attrs.widthPct) || 42))
  const frameHeight = Math.max(36, Number(node.attrs.frameHeight) || 100)
  const naturalWidth = Math.max(1, Number(node.attrs.naturalWidth) || 4)
  const naturalHeight = Math.max(1, Number(node.attrs.naturalHeight) || 3)
  const cropLeft = clampAtlas(node.attrs.cropLeft, 0, 45)
  const cropRight = clampAtlas(node.attrs.cropRight, 0, 45)
  const cropTop = clampAtlas(node.attrs.cropTop, 0, 45)
  const cropBottom = clampAtlas(node.attrs.cropBottom, 0, 45)
  const cropFactorX = Math.max(0.1, (100 - cropLeft - cropRight) / 100)
  const cropFactorY = Math.max(0.1, (100 - cropTop - cropBottom) / 100)
  const visualWidthPct = widthPct * cropFactorX
  const visualHeight = frameHeight * cropFactorY
  const objectFit = node.attrs.objectFit === 'fill' ? 'fill' : node.attrs.objectFit === 'cover' ? 'cover' : 'contain'
  const positionMode = normalizeCardImageMode(node.attrs)
  const freePosition = positionMode === 'free'
  const rootEditor = () => editor?.view?.dom
  const localStartingPosition = () => {
    const wrapper = wrapperRef.current
    const root = rootEditor()
    if (!wrapper || !root) return { xPct: 0, y: 0 }
    const rootRect = root.getBoundingClientRect()
    const imageRect = wrapper.getBoundingClientRect()
    return {
      xPct: Math.max(0, Math.min(96 - widthPct, ((imageRect.left - rootRect.left) / Math.max(1, rootRect.width)) * 100)),
      y: Math.max(0, (imageRect.top - rootRect.top) / safeZoom),
    }
  }
  const removeGestureListeners = () => {
    const listeners = listenersRef.current
    if (!listeners) return
    window.removeEventListener('pointermove', listeners.move, true)
    window.removeEventListener('pointerup', listeners.end, true)
    window.removeEventListener('pointercancel', listeners.cancel, true)
    window.removeEventListener('blur', listeners.cancel, true)
    window.removeEventListener('pagehide', listeners.cancel, true)
    listenersRef.current = null
  }
  useEffect(() => () => { if (!gestureRef.current) removeGestureListeners() }, [])

  useEffect(() => { scheduleCardImageTextFlow(editor, zoom) }, [editor, zoom, widthPct, frameHeight, align, node.attrs.positionX, node.attrs.positionY])

  useEffect(() => {
    const host = wrapperRef.current
    if (!node.attrs.src) {
      if (host) host.atlasContourRows = null
      setContour(null)
      return undefined
    }
    let cancelled = false
    const frame = requestAnimationFrame(() => {
      const bounds = wrapperRef.current?.getBoundingClientRect()
      const aspect = bounds && bounds.width > 2 ? bounds.height / bounds.width : visualHeight / 160
      buildCardImageContour(node.attrs.src, {
        cropLeft, cropRight, cropTop, cropBottom, objectFit, aspect,
      }).then(result => {
        if (cancelled) return
        const live = wrapperRef.current
        if (live) live.atlasContourRows = result?.rows || null
        setContour(result ? { polygon: result.polygon, maskUrl: result.maskUrl } : null)
        scheduleCardImageTextFlow(editor, zoom)
      })
    })
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [node.attrs.src, cropLeft, cropRight, cropTop, cropBottom, objectFit, visualHeight, visualWidthPct, editor, zoom])

  useEffect(() => {
    const root = editor?.view?.dom
    if (!root) return undefined
    // Text lines can paint across the picture. A click in that overlap still
    // belongs to the image, so the middle of the frame can move and resize.
    const onPointerDown = event => {
      if (event.button !== 0) return
      const wrapper = wrapperRef.current
      if (!wrapper) return
      const rect = wrapper.getBoundingClientRect()
      const x = event.clientX
      const y = event.clientY
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return
      // The node's own handler already starts the gesture. A text line drawn
      // across the picture must not swallow the click.
      if (wrapper.contains(event.target)) return
      event.stopPropagation()
      startMoveRef.current?.(event)
    }
    root.addEventListener('pointerdown', onPointerDown, true)
    return () => root.removeEventListener('pointerdown', onPointerDown, true)
  }, [editor])

  const startGesture = (event, mode, edge = 'se') => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const wrapper = wrapperRef.current
    const root = rootEditor()
    if (!wrapper || !root) return
    const rootRect = root.getBoundingClientRect()
    const imageRect = wrapper.getBoundingClientRect()
    const gestureImageId = node.attrs.imageId || makeId()
    if (!node.attrs.imageId) updateAttributes({ imageId: gestureImageId })
    wrapper.classList.add('selected', 'gesturing')
    document.documentElement.classList.add('atlas-image-dragging')
    const findLiveWrapper = () => {
      if (gestureImageId) {
        const live = rootEditor()?.querySelector(`[data-image-id="${CSS.escape(String(gestureImageId))}"]`)
        if (live) return live
      }
      let position
      try { position = typeof getPos === 'function' ? getPos() : null } catch {}
      return (Number.isInteger(position) ? editor.view.nodeDOM(position) : null) || wrapperRef.current
    }
    const startX = freePosition && Number.isFinite(Number(node.attrs.positionX))
      ? Math.max(0, Math.min(100 - visualWidthPct, Number(node.attrs.positionX)))
      : Math.max(0, Math.min(100 - visualWidthPct, ((imageRect.left - rootRect.left) / Math.max(1, rootRect.width)) * 100))
    const startY = freePosition && Number.isFinite(Number(node.attrs.positionY))
      ? Math.max(0, Number(node.attrs.positionY))
      : Math.max(0, (imageRect.top - rootRect.top) / safeZoom)
    const imgElement = wrapper.querySelector('img')
    gestureRef.current = {
      mode, edge, imageId: gestureImageId, pointerId: event.pointerId,
      startClientX: event.clientX, startClientY: event.clientY,
      startX, startY, startWidthPct: visualWidthPct, startHeight: visualHeight,
      sourceWidthPct: widthPct, sourceHeight: frameHeight, cropLeft, cropRight, cropTop, cropBottom,
      cropMode: mode === 'crop', objectFit, rootWidth: Math.max(1, rootRect.width), moved: false,
      originalStyle: wrapper.getAttribute('style') || '',
      originalImageStyle: imgElement?.getAttribute('style') || '',
    }
    // The document capture listeners keep this gesture independent of the
    // image DOM node; React Flow may replace that node during selection.

    // Movement repositions the actual ProseMirror float throughout the gesture.
    // Only resize/crop temporarily use an overlay preview; this keeps live text wrap
    // tied to the actual image node and matches the working Alpha 1.1 mechanic.

    const move = e => {
      const current = gestureRef.current
      if (!current || current.pointerId !== e.pointerId) return
      const dx = e.clientX - current.startClientX
      const dy = e.clientY - current.startClientY
      e.stopPropagation()
      if (!current.moved && Math.hypot(dx, dy) < 3) return
      current.moved = true
      e.preventDefault()
      const element = findLiveWrapper()
      if (!element) return
      element.classList.add('selected', 'gesturing')

      // Absolute placement lets the picture sit in the middle. The wrap pass
      // then fills the free slots on both sides with pretext, which a float cannot.
      const paintFlowWrap = (x, y, width, height) => {
        const bounded = constrainCardImagePosition(x, y, width)
        element.classList.remove('flow-position', 'align-left', 'align-right', 'align-center')
        element.classList.add('free-position', 'gesturing', 'selected')
        element.dataset.positionMode = 'free'
        element.style.setProperty('position', 'absolute', 'important')
        element.style.setProperty('float', 'none', 'important')
        element.style.setProperty('margin', '0', 'important')
        element.style.setProperty('aspect-ratio', 'auto', 'important')
        element.style.setProperty('z-index', 'var(--z-image-preview)', 'important')
        element.style.left = `${bounded.x}%`
        element.style.top = `${bounded.y}px`
        element.style.width = `${width}%`
        element.style.height = `${height}px`
        scheduleCardImageTextFlow(editor, zoom)
      }
      if (current.mode === 'move') {
        let nextX = current.startX + dx / current.rootWidth * 100
        let nextY = current.startY + dy / safeZoom
        const bounded = constrainCardImagePosition(nextX, nextY, current.startWidthPct)
        paintFlowWrap(bounded.x, bounded.y, current.startWidthPct, current.startHeight)
        return
      }

      // Resize and crop preview keeps the same float, so the text keeps wrapping.
      let nextX = current.startX
      let nextY = current.startY
      let nextWidth = current.startWidthPct
      let nextHeight = current.startHeight
      if (current.mode === 'resize') {
        const resized = resizeCardImageFrame({ edge: current.edge, startX: current.startX, startY: current.startY, startWidth: current.startWidthPct, startHeight: current.startHeight, deltaXPercent: dx / current.rootWidth * 100, deltaY: dy / safeZoom })
        nextX = resized.x; nextY = resized.y; nextWidth = resized.width; nextHeight = resized.height
      } else if (current.mode === 'crop') {
        const deltaX = dx / Math.max(1, current.rootWidth * (current.sourceWidthPct / 100)) * 100
        const deltaY = dy / Math.max(1, current.sourceHeight * safeZoom) * 100
        current.previewCropLeft = current.cropLeft
        current.previewCropRight = current.cropRight
        current.previewCropTop = current.cropTop
        current.previewCropBottom = current.cropBottom
        if (current.edge.includes('w')) current.previewCropLeft = clampAtlas(current.cropLeft + deltaX, 0, 85 - current.cropRight)
        if (current.edge.includes('e')) current.previewCropRight = clampAtlas(current.cropRight - deltaX, 0, 85 - current.cropLeft)
        if (current.edge.includes('n')) current.previewCropTop = clampAtlas(current.cropTop + deltaY, 0, 85 - current.cropBottom)
        if (current.edge.includes('s')) current.previewCropBottom = clampAtlas(current.cropBottom - deltaY, 0, 85 - current.cropTop)
        nextWidth = current.sourceWidthPct * (100 - current.previewCropLeft - current.previewCropRight) / 100
        nextHeight = current.sourceHeight * (100 - current.previewCropTop - current.previewCropBottom) / 100
        if (current.edge.includes('w')) nextX = current.startX + current.startWidthPct - nextWidth
        if (current.edge.includes('n')) nextY = current.startY + current.startHeight - nextHeight
        const previewImage = element.querySelector('img')
        if (previewImage) Object.assign(previewImage.style, cropImageStyle(current.previewCropLeft, current.previewCropTop, current.previewCropRight, current.previewCropBottom, current.objectFit))
      }
      paintFlowWrap(nextX, nextY, nextWidth, nextHeight)
      const previewImage = element.querySelector('img')
      if (previewImage && current.mode === 'resize') previewImage.style.objectFit = 'fill'
      scheduleCardImageTextFlow(editor, zoom)
    }
    const end = e => {
      const current = gestureRef.current
      if (!current || (Number.isInteger(e.pointerId) && current.pointerId !== e.pointerId)) return
      e.preventDefault?.(); e.stopPropagation?.()
      gestureRef.current = null
      setImageSelected(true)
      removeGestureListeners()
      const element = findLiveWrapper()
      if (!element) return
      element.classList.remove('gesturing')
      document.documentElement.classList.remove('atlas-image-dragging')
      const dx = e.clientX - current.startClientX
      const dy = e.clientY - current.startClientY
      const horizontalDelta = dx / current.rootWidth * 100
      const verticalDelta = dy / safeZoom
      const resized = current.mode === 'resize'
        ? resizeCardImageFrame({ edge: current.edge, startX: current.startX, startY: current.startY, startWidth: current.startWidthPct, startHeight: current.startHeight, deltaXPercent: horizontalDelta, deltaY: verticalDelta })
        : { x: current.startX + horizontalDelta, y: current.startY + verticalDelta, width: current.startWidthPct, height: current.startHeight }
      let { x: nextX, y: nextY, width: nextWidth, height: nextHeight } = resized
      if (current.mode === 'move') {
        const bounded = constrainCardImagePosition(nextX, nextY, current.startWidthPct)
        nextX = bounded.x; nextY = bounded.y
      }
      let nextAttrs
      if (current.mode === 'crop') {
        nextX = current.startX
        nextY = current.startY
        const deltaX = (e.clientX - current.startClientX) / Math.max(1, current.rootWidth * (current.sourceWidthPct / 100)) * 100
        const deltaY = (e.clientY - current.startClientY) / Math.max(1, current.sourceHeight * safeZoom) * 100
        const finalCropLeft = current.edge.includes('w') ? clampAtlas(current.cropLeft + deltaX, 0, 85 - current.cropRight) : current.cropLeft
        const finalCropRight = current.edge.includes('e') ? clampAtlas(current.cropRight - deltaX, 0, 85 - current.cropLeft) : current.cropRight
        const finalCropTop = current.edge.includes('n') ? clampAtlas(current.cropTop + deltaY, 0, 85 - current.cropBottom) : current.cropTop
        const finalCropBottom = current.edge.includes('s') ? clampAtlas(current.cropBottom - deltaY, 0, 85 - current.cropTop) : current.cropBottom
        nextWidth = current.sourceWidthPct * (100 - finalCropLeft - finalCropRight) / 100
        nextHeight = current.sourceHeight * (100 - finalCropTop - finalCropBottom) / 100
        if (current.edge.includes('w')) nextX += current.startWidthPct - nextWidth
        if (current.edge.includes('n')) nextY += current.startHeight - nextHeight
        nextAttrs = {
          cropLeft: Math.round(finalCropLeft * 100) / 100,
          cropRight: Math.round(finalCropRight * 100) / 100,
          cropTop: Math.round(finalCropTop * 100) / 100,
          cropBottom: Math.round(finalCropBottom * 100) / 100,
          ...(freePosition ? { positionMode: 'free', positionX: Math.round(nextX * 100) / 100, positionY: Math.round(nextY) } : {}),
        }
      } else if (current.mode === 'move') {
        const bounded = constrainCardImagePosition(nextX, nextY, current.startWidthPct)
        nextAttrs = { positionMode: 'free', layoutPreset: 'free', positionX: Math.round(bounded.x * 100) / 100, positionY: Math.round(bounded.y), xPercent: Math.round(nextX * 100) / 100, offsetY: Math.round(bounded.y), widthPct: Math.round(current.sourceWidthPct * 100) / 100, frameHeight: Math.round(current.sourceHeight) }
      } else {
        const visibleX = Math.max(0.1, (100 - current.cropLeft - current.cropRight) / 100)
        const visibleY = Math.max(0.1, (100 - current.cropTop - current.cropBottom) / 100)
        const bounded = constrainCardImagePosition(nextX, nextY, nextWidth)
        nextAttrs = { align, layoutPreset: 'free', positionMode: 'free', positionX: Math.round(bounded.x * 100) / 100, positionY: Math.round(bounded.y), xPercent: Math.round(nextX * 100) / 100, offsetY: Math.round(bounded.y), widthPct: Math.round((nextWidth / visibleX) * 100) / 100, frameHeight: Math.round(nextHeight / visibleY), objectFit: 'fill' }
      }

      if (current.mode !== 'move') {
        if (current.originalStyle) element.setAttribute('style', current.originalStyle)
        else element.removeAttribute('style')
        const currentImage = element.querySelector('img')
        if (currentImage) {
          if (current.originalImageStyle) currentImage.setAttribute('style', current.originalImageStyle)
          else currentImage.removeAttribute('style')
        }
      }
      element.dataset.positionMode = nextAttrs?.positionMode || 'free'

      if (current.moved && nextAttrs) updateAttributes(nextAttrs)
      requestAnimationFrame(() => {
        const position = findCardImagePosition(editor, current.imageId || node.attrs.imageId || null, (() => { try { return typeof getPos === 'function' ? getPos() : null } catch { return null } })())
        if (Number.isInteger(position) && editor.state.doc.nodeAt(position)?.type.name === 'image') editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))
      })
      scheduleCardImageTextFlow(editor, zoom)
    }
    const cancel = e => {
      const current = gestureRef.current
      if (!current || (Number.isInteger(e.pointerId) && current.pointerId !== e.pointerId)) return
      gestureRef.current = null; removeGestureListeners()
      document.documentElement.classList.remove('atlas-image-dragging')
      const element = findLiveWrapper()
      if (!element) return
      element.classList.remove('gesturing')
      if (current.originalStyle) element.setAttribute('style', current.originalStyle)
      else element.removeAttribute('style')
      const currentImage = element.querySelector('img')
      if (currentImage) {
        if (current.originalImageStyle) currentImage.setAttribute('style', current.originalImageStyle)
        else currentImage.removeAttribute('style')
      }
      element.dataset.positionMode = positionMode
      scheduleCardImageTextFlow(editor, zoom)
    }
    listenersRef.current = { move, end, cancel }
    window.addEventListener('pointermove', move, { capture: true, passive: false })
    window.addEventListener('pointerup', end, { capture: true, passive: false })
    window.addEventListener('pointercancel', cancel, { capture: true, passive: false })
    window.addEventListener('blur', cancel, true)
    window.addEventListener('pagehide', cancel, true)
  }

  const startMove = event => {
    if (event.target?.closest?.('.card-image-resize-grip')) return
    const rect = wrapperRef.current?.getBoundingClientRect()
    const edge = rect ? imageEdgeFromPoint(event, rect) : null
    // Ctrl is the explicit move modifier. Dragging the image interior also
    // remains supported; border grips resize without needing Ctrl, Alt crops.
    if (event.ctrlKey) { startGesture(event, 'move'); return }
    if (event.altKey && edge) { startGesture(event, 'crop', edge); return }
    if (edge) { startGesture(event, 'resize', edge); return }
    startGesture(event, 'move')
  }
  startMoveRef.current = startMove
  const original = () => {
    const editorWidth = (rootEditor()?.getBoundingClientRect().width || 1) / safeZoom
    const originalPct = Math.max(8, Math.min(96, (naturalWidth / editorWidth) * 100))
    updateAttributes({ objectFit: 'fill', widthPct: Math.round(originalPct * 100) / 100, frameHeight: naturalHeight, positionMode: 'flow', positionX: null, positionY: null, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 })
  }
  const handles = ['nw','n','ne','e','se','s','sw','w']
  const resizeGripStyle = edge => {
    const half = 12 / safeZoom
    const style = { width: `${24 / safeZoom}px`, height: `${24 / safeZoom}px`, borderWidth: '0px', boxShadow: 'none' }
    if (edge.includes('n')) Object.assign(style, { top: `${-half}px` })
    if (edge.includes('s')) Object.assign(style, { bottom: `${-half}px` })
    if (edge.includes('w')) Object.assign(style, { left: `${-half}px` })
    if (edge.includes('e')) Object.assign(style, { right: `${-half}px` })
    if (edge === 'n' || edge === 's') Object.assign(style, { left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' })
    else if (edge === 'e' || edge === 'w') Object.assign(style, { top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' })
    else Object.assign(style, { cursor: edge === 'nw' || edge === 'se' ? 'nwse-resize' : 'nesw-resize' })
    return style
  }
  const placedX = freePosition
    ? Math.max(0, Number(node.attrs.positionX) || 0)
    : (node.attrs.xPercent === null || node.attrs.xPercent === undefined
      ? (align === 'right' ? Math.max(0, 100 - visualWidthPct) : 0)
      : Math.max(0, Number(node.attrs.xPercent) || 0))
  const placedY = Math.max(0, Number(freePosition ? node.attrs.positionY : node.attrs.offsetY) || 0)

  return <NodeViewWrapper as="div" ref={wrapperRef}
    className={`card-image-node nodrag align-${align} free-position ${selected || imageSelected ? 'selected' : ''} ${imageHovered ? 'is-hovered' : ''}`}
    data-image-id={node.attrs.imageId || undefined}
    contentEditable={false} draggable="false"
    data-position-mode="free"
    onMouseEnter={() => setImageHovered(true)} onMouseLeave={() => setImageHovered(false)}
    onPointerEnter={() => setImageHovered(true)} onPointerLeave={() => setImageHovered(false)}
    style={{ '--canvas-zoom': zoom, '--atlas-image-grip-hit': `${Math.max(8, Math.min(22 / safeZoom, visualHeight * 0.22))}px`, '--card-image-flow-margin': '0', '--card-image-flow-top': `${placedY + 1}px`, position: 'absolute', float: 'none', margin: 0, left: `${placedX}%`, top: `${placedY}px`, zIndex: 8, width: `${visualWidthPct}%`, height: `${visualHeight}px`, maxWidth: '96%', aspectRatio: 'auto' }}
    onMouseDown={event => { if (event.button === 0) { event.preventDefault(); event.stopPropagation() } }}
    onPointerDown={startMove}>
    {contextPosition && <ImageContextMenu position={contextPosition} onClose={closeContextMenu} actions={[
      { label: 'Copiar texto selecionado', icon: Copy, onSelect: async () => { const { from, to } = editor.state.selection; if (to > from) await navigator.clipboard?.writeText(editor.state.doc.textBetween(from, to, '\n')); else await navigator.clipboard?.writeText(node.attrs.src || '') } },
      { label: 'Colar texto', icon: ClipboardPaste, onSelect: async () => { const text = await navigator.clipboard?.readText(); if (typeof text === 'string' && text.length) { const { from, to } = editor.state.selection; editor.chain().focus().insertContentAt({ from, to }, normalizeClipboardInlineText(text)).run() } } },
      { label: 'Selecionar tudo no cartão', icon: Type, onSelect: () => editor.chain().focus().selectAll().run() },
      { separator: true },
      { label: 'Voltar ao fluxo do texto', icon: MoveRight, onSelect: () => { const pos = localStartingPosition(); const nextAlign = pos.xPct + widthPct / 2 < 50 ? 'left' : 'right'; updateAttributes({ positionMode: 'flow', align: nextAlign, layoutPreset: nextAlign, positionX: null, positionY: null }) } },
      { label: 'Posição livre no cartão', icon: MoveRight, onSelect: () => { const pos = localStartingPosition(); updateAttributes({ positionMode: 'free', layoutPreset: 'free', positionX: pos.xPct, positionY: pos.y, widthPct, frameHeight }) } },
      { separator: true },
      { label: 'Conter', icon: Maximize2, onSelect: () => updateAttributes({ objectFit: 'contain' }) },
      { label: 'Preencher', icon: ImageIcon, onSelect: () => updateAttributes({ objectFit: 'cover' }) },
      { label: 'Esticar livremente', icon: Maximize2, onSelect: () => updateAttributes({ objectFit: 'fill' }) },
      { label: 'Tamanho original', icon: FileImage, onSelect: original },
      ...(countImagesWithSameSource(editor, node.attrs.src) > 1 ? [{ separator: true }, { label: 'Remover cópias iguais deste cartão', icon: Copy, onSelect: () => {
        const currentPos = typeof getPos === 'function' ? getPos() : -1
        const positions = []
        editor.state.doc.descendants((candidate, pos) => { if (candidate.type.name === 'image' && candidate.attrs.src === node.attrs.src && pos !== currentPos) positions.push(pos) })
        if (positions.length) { let tr = editor.state.tr; positions.sort((a, b) => b - a).forEach(pos => { const duplicate = tr.doc.nodeAt(pos); if (duplicate?.type?.name === 'image' && duplicate.attrs.src === node.attrs.src) tr = tr.delete(pos, pos + duplicate.nodeSize) }); editor.view.dispatch(tr) }
      } }] : []),
      { separator: true }, { label: 'Excluir imagem', icon: Trash2, danger: true, onSelect: deleteNode },
    ]} />}
    <div className="card-image-viewport" style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit', pointerEvents: 'none', ...(contour?.maskUrl ? { maskImage: `url("${contour.maskUrl}")`, WebkitMaskImage: `url("${contour.maskUrl}")`, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' } : {}) }}>
      <img src={node.attrs.src} alt={node.attrs.alt || 'Imagem no cartão'} draggable="false"
        style={cropImageStyle(cropLeft, cropTop, cropRight, cropBottom, objectFit)} />
    </div>
    {handles.map(edge => <span key={edge} className={`card-image-resize-grip edge-${edge} nodrag`} title="Arraste a borda para esticar; Ctrl move a imagem; Alt recorta" aria-label={`Borda ${edge}: arrastar estica, Ctrl move, Alt recorta`}
      style={resizeGripStyle(edge)} onPointerDown={event => { event.stopPropagation(); startGesture(event, event.altKey ? 'crop' : event.ctrlKey ? 'move' : 'resize', edge) }} />)}
  </NodeViewWrapper>
}

const AtlasCardImage = Image.extend({
  draggable: false,
  // Gestures are handled by the node view; ProseMirror's default mouse drag
  // would replace the node DOM before our pointer capture completes.
  selectable: false,
  addAttributes() {
    return {
      ...this.parent?.(),
      imageId: { default: null, parseHTML: element => element.getAttribute('data-image-id') || null, renderHTML: attrs => ({ 'data-image-id': attrs.imageId || makeId() }) },
      align: { default: 'left', parseHTML: element => element.getAttribute('data-card-align') || (element.style.float === 'right' ? 'right' : 'left'), renderHTML: attrs => ({ 'data-card-align': attrs.align || 'left' }) },
      layoutPreset: { default: 'left', parseHTML: element => element.getAttribute('data-layout-preset') || 'left', renderHTML: attrs => ({ 'data-layout-preset': attrs.layoutPreset || 'left' }) },
      widthPct: { default: 42, parseHTML: element => Number(element.getAttribute('data-width-pct')) || 42, renderHTML: attrs => ({ 'data-width-pct': attrs.widthPct || 42 }) },
      frameHeight: { default: 100, parseHTML: element => Number(element.getAttribute('data-frame-height')) || Number(element.getAttribute('height')) || 100, renderHTML: attrs => ({ 'data-frame-height': attrs.frameHeight || 100 }) },
      objectFit: { default: 'contain', parseHTML: element => element.getAttribute('data-object-fit') || 'contain', renderHTML: attrs => ({ 'data-object-fit': attrs.objectFit || 'contain' }) },
      naturalWidth: { default: null, parseHTML: element => Number(element.getAttribute('data-natural-width')) || null, renderHTML: attrs => attrs.naturalWidth ? { 'data-natural-width': attrs.naturalWidth } : {} },
      naturalHeight: { default: null, parseHTML: element => Number(element.getAttribute('data-natural-height')) || null, renderHTML: attrs => attrs.naturalHeight ? { 'data-natural-height': attrs.naturalHeight } : {} },
      cropLeft: { default: 0, parseHTML: element => Number(element.getAttribute('data-crop-left')) || 0, renderHTML: attrs => ({ 'data-crop-left': String(attrs.cropLeft || 0) }) },
      cropRight: { default: 0, parseHTML: element => Number(element.getAttribute('data-crop-right')) || 0, renderHTML: attrs => ({ 'data-crop-right': String(attrs.cropRight || 0) }) },
      cropTop: { default: 0, parseHTML: element => Number(element.getAttribute('data-crop-top')) || 0, renderHTML: attrs => ({ 'data-crop-top': String(attrs.cropTop || 0) }) },
      cropBottom: { default: 0, parseHTML: element => Number(element.getAttribute('data-crop-bottom')) || 0, renderHTML: attrs => ({ 'data-crop-bottom': String(attrs.cropBottom || 0) }) },
      positionMode: { default: 'flow', parseHTML: element => element.getAttribute('data-position-mode') === 'free' || element.getAttribute('data-free-position') === 'true' ? 'free' : 'flow', renderHTML: attrs => ({ 'data-position-mode': attrs.positionMode === 'free' ? 'free' : 'flow' }) },
      positionX: { default: null, parseHTML: element => element.hasAttribute('data-position-x') ? Number(element.getAttribute('data-position-x')) : null, renderHTML: attrs => attrs.positionX !== null && attrs.positionX !== undefined ? { 'data-position-x': String(attrs.positionX) } : {} },
      positionY: { default: null, parseHTML: element => element.hasAttribute('data-position-y') ? Number(element.getAttribute('data-position-y')) : null, renderHTML: attrs => attrs.positionY !== null && attrs.positionY !== undefined ? { 'data-position-y': String(attrs.positionY) } : {} },
      xPercent: { default: null, parseHTML: element => element.hasAttribute('data-flow-x-percent') ? Number(element.getAttribute('data-flow-x-percent')) : null, renderHTML: attrs => attrs.xPercent !== null && attrs.xPercent !== undefined ? { 'data-flow-x-percent': String(attrs.xPercent) } : {} },
      offsetY: { default: 0, parseHTML: element => Number(element.getAttribute('data-flow-offset-y')) || 0, renderHTML: attrs => ({ 'data-flow-offset-y': String(Math.max(0, Number(attrs.offsetY) || 0)) }) },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }
    const align = attrs['data-card-align'] || 'left'
    const widthPct = Number(attrs['data-width-pct']) || 42
    const height = Number(attrs['data-frame-height']) || 100
    const freePosition = attrs['data-position-mode'] === 'free' || attrs['data-free-position'] === 'true'
    const positionX = Number(attrs['data-position-x']) || 0
    const positionY = Number(attrs['data-position-y']) || 0
    const offsetY = Math.max(0, Number(attrs['data-flow-offset-y']) || 0)
    const placedX = freePosition ? positionX : (attrs['data-flow-x-percent'] != null && attrs['data-flow-x-percent'] !== '' ? Number(attrs['data-flow-x-percent']) : (align === 'right' ? Math.max(0, 100 - widthPct) : 0))
    const placedY = freePosition ? positionY : offsetY
    attrs.style = `position:absolute;float:none;margin:0;left:${placedX}%;top:${placedY}px;width:${widthPct}%;height:${height}px;max-width:96%;object-fit:${attrs['data-object-fit'] || 'contain'};`
    return ['img', attrs]
  },
  addNodeView() { return ReactNodeViewRenderer(CardImageNodeView) },
}).configure({ allowBase64: true, inline: false })

function NodeLoreBadges({ data = {} }) {
  const tags = Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 3) : []
  if (!data.status && !data.priority && !data.rarity && !data.level && !tags.length) return null
  const safeClass = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
  return <div className="lore-badges-inline nodrag" aria-label="Etiquetas do cartão">
    {data.status && <span className={`lore-pill status-${safeClass(data.status)}`}>{data.status}</span>}
    {data.priority && data.priority !== 'Normal' && <span className={`lore-pill priority-${safeClass(data.priority)}`}>{data.priority}</span>}
    {data.rarity && <span className={`lore-pill rarity-${safeClass(data.rarity)}`}>{data.rarity}</span>}
    {data.level !== undefined && data.level !== '' && data.level !== null && <span className="lore-pill level-pill">Nv. {data.level}</span>}
    {tags.map(tag => <span className="lore-pill tag-pill" key={tag}>{tag}</span>)}
  </div>
}

function IdeaNode({ id, data, selected }) {
  const ops = useContext(NodeOperationsContext)
  const { zoom = 1 } = useViewport()
  const fileRef = useRef(null)
  const [hovered, setHovered] = useState(false)
  const [contextPosition, setContextPosition] = useState(null)
  const closeContextMenu = useCallback(() => setContextPosition(null), [])
  const opsRef = useRef(ops)
  opsRef.current = ops
  const initialContent = useRef(null)
  if (initialContent.current === null) initialContent.current = buildInitialCardHTML(data)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false, codeBlock: false }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Underline, ...SharedTextExtensions, Placeholder.configure({ placeholder: 'Escreva uma ideia…' }),
      TaskList, TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
      AtlasCardImage, cardTextWrapExtension,
    ],
    content: initialContent.current,
    immediatelyRender: true,
    editorProps: {
      attributes: { class: 'idea-node-editor nodrag nowheel', spellcheck: 'true', 'aria-label': `Conteúdo de ${data.title || 'cartão'}` },
      transformCopied: slice => stripImagesFromCopiedSlice(slice),
      handlePaste: (view, event) => handleInlineTextPaste(view, event),
    },
    onFocus: ({ editor: currentEditor }) => opsRef.current.activateTextEditor?.(currentEditor),
    onSelectionUpdate: ({ editor: currentEditor }) => { opsRef.current.activateTextEditor?.(currentEditor); scheduleCardImageTextFlow(currentEditor, zoom) },
    onUpdate: ({ editor: currentEditor }) => {
      opsRef.current.updateCardContent(id, currentEditor.getHTML(), currentEditor.getText())
      opsRef.current.activateTextEditor?.(currentEditor)
      scheduleCardImageTextFlow(currentEditor, zoom)
      requestAnimationFrame(() => {
        if (currentEditor.isDestroyed) return
        const root = currentEditor.view.dom
        const article = root.closest('.react-flow__node')?.querySelector('.atlas-node.idea-node')
        if (!article) return
        const headerHeight = article.querySelector('.idea-node-head')?.offsetHeight || 34
        const badges = article.querySelector('.lore-badges-inline')
        const badgesHeight = badges ? badges.offsetHeight + 9 : 0
        const requiredHeight = Math.ceil(headerHeight + badgesHeight + Math.max(root.scrollHeight, root.offsetHeight) + 8)
        opsRef.current.growNodeTo?.(id, Math.max(170, requiredHeight))
      })
    },
  }, [id])
  useEffect(() => {
    if (!editor) return
    if (typeof data.richContent !== 'string') opsRef.current.updateCardContent(id, editor.getHTML(), editor.getText())
    scheduleCardImageTextFlow(editor, zoom)
    const root = editor.view.dom
    const article = root.closest('.react-flow__node')?.querySelector('.atlas-node.idea-node')
    const measure = () => {
      if (editor.isDestroyed) return
      const currentArticle = editor.view.dom.closest('.react-flow__node')?.querySelector('.atlas-node.idea-node')
      if (!currentArticle) return
      const headerHeight = currentArticle.querySelector('.idea-node-head')?.offsetHeight || 34
      const badges = currentArticle.querySelector('.lore-badges-inline')
      const badgesHeight = badges ? badges.offsetHeight + 9 : 0
      const requiredHeight = Math.ceil(headerHeight + badgesHeight + Math.max(root.scrollHeight, root.offsetHeight) + 8)
      opsRef.current.growNodeTo?.(id, Math.max(170, requiredHeight))
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => requestAnimationFrame(measure)) : null
    observer?.observe(root)
    requestAnimationFrame(measure)
    return () => observer?.disconnect()
  }, [editor, id, zoom])
  const addImage = async file => {
    if (!file || !editor) return
    if (!file.type.startsWith('image/')) { ops.toast('Escolha um arquivo de imagem.'); return }
    try {
      const src = await readImageForAtlas(file)
      const dimensions = await new Promise(resolve => { const probe = new window.Image(); probe.onload = () => resolve({ width: probe.naturalWidth || 160, height: probe.naturalHeight || 100 }); probe.onerror = () => resolve({ width: 160, height: 100 }); probe.src = src })
      editor.chain().focus().setImage({ src, alt: file.name, title: file.name, imageId: makeId(), align: 'left', widthPct: 42, frameHeight: Math.max(60, Math.min(240, Math.round(270 * 0.42 * dimensions.height / Math.max(1, dimensions.width)))), naturalWidth: dimensions.width, naturalHeight: dimensions.height, objectFit: 'contain' }).run()
      ops.storeImage?.(file.name, src)
    } catch { ops.toast('Não foi possível inserir a imagem.') }
    if (fileRef.current) fileRef.current.value = ''
  }
  return <article data-atlas-card-id={id} className={`atlas-node idea-node ${selected ? 'selected' : ''}`} style={{ '--canvas-zoom': zoom }}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextPosition({ x: event.clientX, y: event.clientY }) }}>
    <HoverNodeResizer hovered={hovered} zoom={zoom} minWidth={250} minHeight={170} />
    <input ref={fileRef} hidden type="file" accept="image/*" onChange={e => addImage(e.target.files?.[0])} />
    <ConnectionPorts />
    <div className="idea-node-head" title="Arraste uma área livre do cartão para movê-lo">
      <button className="node-delete nodrag" title="Excluir cartão" aria-label="Excluir cartão" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ops.deleteNode(id) }}>×</button>
      <EditableName name={data.title || 'Novo cartão'} onSave={value => ops.updateNodeData(id, 'title', value)} className="node-editable-title" title="Renomear cartão" />
      <button type="button" className="node-details-trigger nodrag" title="Abrir ficha e metadados" aria-label="Abrir ficha e metadados" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ops.openNodeDetails?.(id) }}><BookOpen size={13} /></button>
      <button type="button" className="node-inline-action nodrag" title="Inserir imagem dentro deste cartão" aria-label="Inserir imagem dentro deste cartão" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); fileRef.current?.click() }}><ImageIcon size={14} strokeWidth={1.8} /></button>
    </div>
    <NodeLoreBadges data={data} />
    <div className="idea-node-body"><EditorContent editor={editor} /></div>
    {contextPosition && <ImageContextMenu position={contextPosition} onClose={closeContextMenu} ariaLabel="Opções do cartão" actions={[
      { label: 'Copiar texto selecionado', icon: Copy, onSelect: async () => { const { from, to } = editor.state.selection; if (to > from) await navigator.clipboard?.writeText(editor.state.doc.textBetween(from, to, '\n')); else ops.copyNode?.(id) } },
      { label: 'Colar texto', icon: ClipboardPaste, onSelect: async () => { const text = await navigator.clipboard?.readText(); if (typeof text === 'string' && text.length) { const { from, to } = editor.state.selection; editor.chain().focus().insertContentAt({ from, to }, normalizeClipboardInlineText(text)).run() } } },
      { label: 'Selecionar tudo no cartão', icon: Type, onSelect: () => editor.chain().focus().selectAll().run() },
      { separator: true },
      { label: 'Apagar cartão', icon: Trash2, danger: true, onSelect: () => ops.deleteNode(id) },
      { label: 'Copiar cartão', icon: Copy, onSelect: () => ops.copyNode?.(id) },
      { separator: true },
      { label: 'Adicionar imagem dentro do cartão', icon: ImageIcon, onSelect: () => fileRef.current?.click() },
    ]} />}
  </article>
}

function ImageNode({ id, data, selected }) {
  const ops = useContext(NodeOperationsContext)
  const { setNodes } = useReactFlow()
  const { zoom = 1 } = useViewport()
  const [hovered, setHovered] = useState(false)
  const [contextPosition, setContextPosition] = useState(null)
  const closeContextMenu = useCallback(() => setContextPosition(null), [])
  const fit = (objectFit, extra = {}) => ops.patchNode(id, { data: { ...data, objectFit, ...extra } })
  const original = () => {
    const width = Math.max(100, Math.min(1000, Number(data.naturalWidth) || 260))
    const height = Math.max(75, Math.min(800, Number(data.naturalHeight) || 180))
    setNodes(current => current.map(node => node.id === id ? { ...node, style: { ...node.style, width, height } } : node))
    fit('contain', { original: true })
  }
  return <article className={`atlas-node standalone-image ${selected ? 'selected' : ''}`} style={{ '--canvas-zoom': zoom }}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextPosition({ x: event.clientX, y: event.clientY }) }}>
    <HoverNodeResizer hovered={hovered} zoom={zoom} minWidth={100} minHeight={76} />
    <ConnectionPorts />
    <div className="standalone-image-frame" aria-hidden="true">
      <img src={data.src} alt="" draggable="false" style={{ objectFit: data.objectFit || 'contain' }} />
    </div>
    <div className="standalone-image-head" title="Clique e arraste a imagem para movê-la"><EditableName name={data.name || 'Imagem'} onSave={name => ops.updateNodeData(id, 'name', name)} className="standalone-image-editable-title" title="Renomear imagem" /></div>
    <button type="button" className="node-details-trigger node-details-float nodrag" title="Abrir ficha e metadados" aria-label="Abrir ficha e metadados" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ops.openNodeDetails?.(id) }}><BookOpen size={13} /></button>
    {contextPosition && <ImageContextMenu position={contextPosition} onClose={closeContextMenu} actions={[
      { label: 'Copiar imagem/objeto', icon: Copy, onSelect: () => ops.copyNode?.(id) },
      { label: 'Colar objeto(s)', icon: ClipboardPaste, onSelect: () => window.dispatchEvent(new CustomEvent('atlas:context-paste')) },
      { label: 'Selecionar tudo no canvas', icon: Type, onSelect: () => window.dispatchEvent(new CustomEvent('atlas:context-select-all')) },
      { separator: true },
      { label: 'Conter', icon: Maximize2, onSelect: () => fit('contain') },
      { label: 'Preencher', icon: ImageIcon, onSelect: () => fit('cover') },
      { label: 'Esticar', icon: Maximize2, onSelect: () => fit('fill') },
      { label: 'Tamanho original', icon: FileImage, onSelect: original },
      { separator: true },
      { label: 'Excluir imagem', icon: Trash2, danger: true, onSelect: () => ops.deleteNode(id) },
    ]} />}
  </article>
}

function normalizeTableCellHTML(value) {
  const text = String(value ?? '')
  if (!text.trim()) return '<p></p>'
  if (/<(?:p|div|strong|em|u|s|span|mark|h[1-6]|ul|ol|li|blockquote|pre|code|a)\b/i.test(text)) return text
  return `<p>${escapeHTML(text).replace(/\r?\n/g, '<br>')}</p>`
}

function TableCellRichEditor({ nodeId, rowIndex, colIndex, value, legacyColor, ops }) {
  const initialHTML = useRef(normalizeTableCellHTML(value))
  const extensions = useMemo(() => [
    StarterKit.configure({ link: false, underline: false, codeBlock: false }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Underline, ...SharedTextExtensions, Placeholder.configure({ placeholder: 'Escreva…' }),
    TaskList, TaskItem.configure({ nested: true }),
  ], [])
  const editor = useEditor({
    extensions,
    content: initialHTML.current,
    immediatelyRender: true,
    editorProps: { attributes: { class: 'canvas-table-cell-editor nodrag nowheel', 'aria-label': `Célula ${rowIndex + 1}, coluna ${colIndex + 1}` }, transformCopied: slice => stripImagesFromCopiedSlice(slice), handlePaste: handleInlineTextPaste },
    onFocus: ({ editor: current }) => ops.activateTextEditor?.(current),
    onSelectionUpdate: ({ editor: current }) => ops.activateTextEditor?.(current),
    onUpdate: ({ editor: current }) => {
      ops.updateTableCell?.(nodeId, rowIndex, colIndex, current.getHTML())
      ops.activateTextEditor?.(current)
    },
  }, [nodeId, rowIndex, colIndex])

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    const nextHTML = normalizeTableCellHTML(value)
    if (editor.getHTML() !== nextHTML) editor.commands.setContent(nextHTML, { emitUpdate: false })
  }, [editor, value])

  return <div className="canvas-table-cell-rich" style={legacyColor ? { color: legacyColor } : undefined}
    onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <EditorContent editor={editor} />
  </div>
}

function TableNode({ id, data, selected }) {
  const ops = useContext(NodeOperationsContext)
  const { zoom = 1 } = useViewport()
  const [hovered, setHovered] = useState(false)
  const rows = data.matrix?.length || 5
  const cols = data.matrix?.[0]?.length || 4
  const matrix = data.matrix || Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ''))
  const cellColors = data.cellColors || []
  const renameTitle = (value) => ops.updateNodeData(id, 'title', value)
  return <article className={`atlas-node table-node ${selected ? 'selected' : ''}`} style={{ '--canvas-zoom': zoom }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <HoverNodeResizer hovered={hovered} zoom={zoom} minWidth={240} minHeight={120} />
    <ConnectionPorts />
    <div className="table-node-title" title="Segure a barra para mover a tabela"><EditableName name={data.title || 'Tabela'} onSave={renameTitle} className="table-node-editable-title" title="Renomear tabela" /><button type="button" className="node-details-trigger nodrag" title="Abrir ficha e metadados" aria-label="Abrir ficha e metadados" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ops.openNodeDetails?.(id) }}><BookOpen size={13} /></button></div>
    <div className="table-node-grid-wrap nodrag nowheel"><table className="canvas-table"><tbody>{Array.from({ length: rows }, (_, r) => <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><TableCellRichEditor nodeId={id} rowIndex={r} colIndex={c} value={matrix[r]?.[c] || ''} legacyColor={cellColors[r]?.[c]} ops={ops} /></td>)}</tr>)}</tbody></table></div>
  </article>
}

function GroupNode({ id, data, selected }) {
  const ops = useContext(NodeOperationsContext)
  const { zoom = 1 } = useViewport()
  const [hovered, setHovered] = useState(false)
  return <article className={`atlas-node group-node ${selected ? 'selected' : ''}`} style={{ '--canvas-zoom': zoom }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <HoverNodeResizer hovered={hovered} zoom={zoom} minWidth={180} minHeight={120} />
    <ConnectionPorts />
    <div className="group-node-head" title="Segure a barra para mover o grupo"><EditableName name={data.title || 'Grupo'} onSave={value => ops.updateNodeData(id, 'title', value)} className="group-node-editable-title" title="Renomear grupo" /><button type="button" className="node-details-trigger nodrag" title="Abrir ficha e metadados" aria-label="Abrir ficha e metadados" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ops.openNodeDetails?.(id) }}><BookOpen size={13} /></button></div>
    <span className="group-node-hint">Área de organização</span>
  </article>
}
function DocumentCanvasNode({ id, data, selected }) {
  const ops = useContext(NodeOperationsContext)
  const { zoom = 1 } = useViewport()
  const [hovered, setHovered] = useState(false)
  const [contextPosition, setContextPosition] = useState(null)
  const fileRef = useRef(null)
  const opsRef = useRef(ops); opsRef.current = ops
  const initialContent = useRef(typeof data.richContent === 'string' ? data.richContent : '<p></p>')
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false, codeBlock: false }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }), Underline, ...SharedTextExtensions,
      Placeholder.configure({ placeholder: 'Escreva no documento…' }), TaskList, TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'doc-canvas-table' } }), TableRow, TableHeader, TableCell, AtlasDocumentImage,
    ],
    content: initialContent.current,
    immediatelyRender: true,
    editorProps: { attributes: { class: 'document-node-editor nodrag nowheel', spellcheck: 'true', 'aria-label': `Documento ${data.title || 'sem título'}` }, transformCopied: slice => stripImagesFromCopiedSlice(slice), handlePaste: handleInlineTextPaste },
    onFocus: ({ editor: current }) => opsRef.current.activateTextEditor?.(current),
    onSelectionUpdate: ({ editor: current }) => opsRef.current.activateTextEditor?.(current),
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML()
      opsRef.current.updateDocumentCardContent?.(id, data.documentId, html)
      opsRef.current.activateTextEditor?.(current)
      scheduleDocumentImageTextFlow(current)
    },
  }, [id])
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    const next = typeof data.richContent === 'string' ? data.richContent : '<p></p>'
    if (editor.getHTML() !== next) editor.commands.setContent(next, { emitUpdate: false })
  }, [editor, data.richContent])
  const addImage = async file => {
    if (!file || !editor) return
    if (!file.type?.startsWith('image/')) { ops.toast?.('Selecione uma imagem.'); return }
    try {
      const src = await readImageForAtlas(file)
      const dimensions = await new Promise(resolve => { const probe = new window.Image(); probe.onload = () => resolve({ width: probe.naturalWidth || 640, height: probe.naturalHeight || 420 }); probe.onerror = () => resolve({ width: 640, height: 420 }); probe.src = src })
      const width = Math.min(620, dimensions.width)
      const height = Math.round(width * dimensions.height / Math.max(1, dimensions.width))
      editor.chain().focus().setImage({ src, alt: file.name, title: file.name, width, height: Math.max(40, height), naturalWidth: dimensions.width, naturalHeight: dimensions.height, objectFit: 'contain' }).run()
      ops.storeImage?.(file.name, src)
    } catch { ops.toast?.('Não foi possível inserir a imagem no documento.') }
    if (fileRef.current) fileRef.current.value = ''
  }
  const openMenu = event => { event.preventDefault(); event.stopPropagation(); setContextPosition({ x: event.clientX, y: event.clientY }) }
  const actions = [
    { label: 'Abrir documento original', icon: ExternalLink, onSelect: () => ops.openLinkedDocument?.(data.documentId) },
    { label: 'Copiar cartão-documento', icon: Copy, onSelect: () => ops.copyNode?.(id) },
    { label: 'Colar objeto(s)', icon: ClipboardPaste, onSelect: () => window.dispatchEvent(new CustomEvent('atlas:context-paste')) },
    { label: 'Selecionar tudo no canvas', icon: Type, onSelect: () => window.dispatchEvent(new CustomEvent('atlas:context-select-all')) },
    { label: 'Adicionar imagem ao documento', icon: ImageIcon, onSelect: () => fileRef.current?.click() },
    { separator: true },
    { label: 'Remover do canvas', icon: Trash2, danger: true, onSelect: () => ops.deleteNode?.(id) },
  ]
  return <article className={`atlas-node document-node ${selected ? 'selected' : ''}`} style={{ '--canvas-zoom': zoom }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onContextMenu={openMenu}>
    <HoverNodeResizer hovered={hovered} zoom={zoom} minWidth={300} minHeight={220} />
    <ConnectionPorts />
    <div className="document-node-head" title="Segure o cabeçalho para mover o documento">
      <FileText size={13} strokeWidth={1.8} />
      <EditableName name={data.title || 'Documento'} onSave={name => { ops.updateNodeData(id, 'title', name); ops.renameLinkedDocument?.(data.documentId, name) }} className="document-node-editable-title" title="Renomear documento" />
      <button type="button" className="node-details-trigger nodrag" title="Abrir ficha e metadados" aria-label="Abrir ficha e metadados" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ops.openNodeDetails?.(id) }}><BookOpen size={13} /></button>
      <button type="button" className="document-node-menu icon-button nodrag" aria-label="Opções do documento" title="Opções do documento" onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setContextPosition({ x: rect.right, y: rect.bottom }) }}><MoreHorizontal size={14} /></button>
    </div>
    <input ref={fileRef} hidden type="file" accept="image/*" onChange={event => addImage(event.target.files?.[0])} />
    <div className="document-node-body"><EditorContent editor={editor} /></div>
    {contextPosition && <ImageContextMenu position={contextPosition} onClose={() => setContextPosition(null)} ariaLabel="Opções do documento no canvas" actions={actions} />}
  </article>
}

const nodeTypes = { idea: IdeaNode, image: ImageNode, table: TableNode, group: GroupNode, document: DocumentCanvasNode }
const edgeTypes = { smoothstep: CenteredConnectionEdge }

function EditableName({ name, onSave, className = '', inputClassName = '', title = 'Renomear' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name || '')
  const inputRef = useRef(null)
  const canceledEdit = useRef(false)
  useEffect(() => { if (!editing) setDraft(name || '') }, [name, editing])
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])
  const commit = () => {
    if (canceledEdit.current) { canceledEdit.current = false; return }
    const next = draft.trim() || name || 'Sem título'
    setDraft(next); setEditing(false)
    if (next !== name) onSave?.(next)
  }
  return <span className={`editable-name ${className}`}>
    {editing ? <input ref={inputRef} className={`editable-name-input ${inputClassName} nodrag`} value={draft} style={{ width: `${Math.max(86, Math.min(380, draft.length * 7.2 + 24))}px` }} maxLength={90}
      aria-label="Nome do arquivo" onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } if (event.key === 'Escape') { event.preventDefault(); canceledEdit.current = true; setDraft(name || ''); setEditing(false) } }} />
      : <span className="editable-name-text" title={name}>{name || 'Sem título'}</span>}
    <button type="button" className="editable-name-pencil icon-button nodrag" aria-label={title} title={title} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); canceledEdit.current = false; setDraft(name || ''); setEditing(true) }}><Pencil size={12} strokeWidth={1.8} /></button>
  </span>
}

function cloneCanvasNodeForHistory(node) {
  const copy = JSON.parse(JSON.stringify(node))
  delete copy.internals; delete copy.positionAbsolute; delete copy.dragging; delete copy.resizing
  return { ...copy, selected: false, dragging: false, resizing: false }
}
function createCanvasSnapshot(nodes, edges) {
  return {
    nodes: nodes.map(cloneCanvasNodeForHistory),
    edges: edges.map(edge => {
      const copy = JSON.parse(JSON.stringify(edge))
      delete copy.selected
      return { ...copy, selected: false }
    }),
  }
}
function isEditableEventTarget(target) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],.ProseMirror'))
}

function flattenClipboardHTML(html) {
  if (!html || typeof document === 'undefined') return ''
  const holder = document.createElement('div')
  holder.innerHTML = html
  holder.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode(' ')))
  holder.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote').forEach(node => {
    if (node.previousSibling) node.parentNode?.insertBefore(document.createTextNode(' '), node)
  })
  return holder.textContent || ''
}
function normalizeClipboardInlineText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\n\u2028\u2029]+/g, ' ')
    .replace(/[\t ]+/g, ' ')
}
function handleInlineTextPaste(view, event) {
  const clipboard = event?.clipboardData
  if (!clipboard) return false
  // Pasted screenshots/images should become editable image nodes when the editor schema supports them.
  const pastedImage = Array.from(clipboard.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    || Array.from(clipboard.files || []).find(file => String(file.type || '').startsWith('image/'))
  const imageNodeType = view.state.schema.nodes.image
  if (pastedImage && imageNodeType) {
    event.preventDefault()
    event.stopPropagation()
    void readImageForAtlas(pastedImage).then(src => {
      if (!view.dom?.isConnected) return
      const state = view.state
      const node = state.schema.nodes.image?.create({ src, alt: pastedImage.name || 'Imagem colada', title: pastedImage.name || 'Imagem colada' })
      if (node) view.dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
    }).catch(error => console.warn('Atlas: não foi possível colar a imagem', error))
    return true
  }
  // Text paste is normalized into inline plain text to prevent malformed rich HTML.
  // Capture both ends of the CURRENT ProseMirror selection: a selection is replaced.
  let plain = clipboard.getData('text/plain') ?? ''
  // Some rich-text sources populate only text/html. Extract readable text as a
  // fallback rather than consuming the paste event with an empty insertion.
  if (!plain && clipboard.getData('text/html')) {
    const parsed = new DOMParser().parseFromString(clipboard.getData('text/html'), 'text/html')
    plain = parsed.body?.textContent || ''
  }
  const normalized = normalizeClipboardInlineText(plain)
  event.preventDefault()
  event.stopPropagation()
  const { state, dispatch } = view
  const { from, to } = state.selection
  if (normalized) dispatch(state.tr.insertText(normalized, from, to).scrollIntoView())
  return true
}

function rectsIntersect(a, b) {
  return Boolean(a && b && a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top)
}
function nodeClientRect(node, stageRect, viewport) {
  const position = node.positionAbsolute || node.position || { x: 0, y: 0 }
  const zoom = Math.max(0.05, Number(viewport?.zoom) || 1)
  const fallback = { idea: [290, 230], table: [390, 270], image: [260, 180], group: [300, 220], document: [420, 520] }[node.type] || [280, 180]
  const width = Number(node.measured?.width || node.width || Number.parseFloat(node.style?.width)) || fallback[0]
  const height = Number(node.measured?.height || node.height || Number.parseFloat(node.style?.height)) || fallback[1]
  const left = stageRect.left + (Number(viewport?.x) || 0) + Number(position.x || 0) * zoom
  const top = stageRect.top + (Number(viewport?.y) || 0) + Number(position.y || 0) * zoom
  return { left, top, right: left + width * zoom, bottom: top + height * zoom, width: width * zoom, height: height * zoom }
}
function svgPathIntersectsRect(path, rect) {
  if (!path) return false
  try {
    if (typeof path.getTotalLength === 'function' && typeof path.getPointAtLength === 'function') {
      const length = path.getTotalLength()
      const matrix = path.getScreenCTM?.()
      const svg = path.ownerSVGElement
      if (length > 0 && matrix && svg?.createSVGPoint) {
        const point = svg.createSVGPoint()
        const step = Math.max(2, Math.min(5, length / 160))
        for (let distance = 0; distance <= length; distance += step) {
          const local = path.getPointAtLength(distance)
          point.x = local.x; point.y = local.y
          const screen = point.matrixTransform(matrix)
          if (screen.x >= rect.left && screen.x <= rect.right && screen.y >= rect.top && screen.y <= rect.bottom) return true
        }
        const end = path.getPointAtLength(length)
        point.x = end.x; point.y = end.y
        const screenEnd = point.matrixTransform(matrix)
        if (screenEnd.x >= rect.left && screenEnd.x <= rect.right && screenEnd.y >= rect.top && screenEnd.y <= rect.bottom) return true
        return false
      }
    }
  } catch { /* Fall back to the screen-space bounding box below. */ }
  return rectsIntersect(path.getBoundingClientRect?.(), rect)
}

function LoreDetailsDrawer({ node, onClose, onUpdate, onOpenDocument }) {
  const data = node?.data || {}
  const titleKey = node?.type === 'image' ? 'name' : 'title'
  const title = data[titleKey] || ({ idea: 'Novo cartão', image: 'Imagem', table: 'Tabela', group: 'Grupo', document: 'Documento' }[node?.type] || 'Objeto')
  const tags = Array.isArray(data.tags) ? data.tags : []
  const [tagsDraft, setTagsDraft] = useState(tags.join(', '))
  const badgeClass = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
  const typeName = ({ idea: 'Ideia / personagem', image: 'Imagem de referência', table: 'Tabela / atributos', group: 'Grupo / coleção', document: 'Documento relacionado' }[node?.type] || 'Objeto do canvas')
  const fallbackHtml = String(data.richContent || '').replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim()
  const bodyPreview = String(data.loreDescription || data.text || fallbackHtml || '').trim()
  const update = (key, value) => onUpdate?.(key, value)
  const updateTags = raw => update('tags', raw.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 12))
  return <aside className="lore-drawer" role="complementary" aria-label={`Ficha de ${title}`}>
    <header className="lore-drawer-header">
      <div className="lore-drawer-symbol">{node.type === 'image' ? <ImageIcon size={18} /> : node.type === 'document' ? <FileText size={18} /> : node.type === 'group' ? <Layers3 size={18} /> : node.type === 'table' ? <Table2 size={18} /> : <Network size={18} />}</div>
      <div className="lore-drawer-heading"><span>LORE WORKSPACE</span><h3>{title}</h3><p>{typeName}</p></div>
      <button type="button" className="icon-button lore-drawer-close" onClick={onClose} title="Fechar ficha" aria-label="Fechar ficha"><X size={16} /></button>
    </header>
    <div className="lore-drawer-scroll">
      {node.type === 'image' && data.src ? <div className="lore-drawer-image"><img src={data.src} alt={title} /></div> : <div className="lore-drawer-cover"><div className="lore-cover-pattern" /><span className="lore-cover-type">{node.type === 'idea' ? 'IDEIA & NARRATIVA' : node.type === 'document' ? 'DOCUMENTO VINCULADO' : node.type === 'table' ? 'DADOS & ATRIBUTOS' : 'ORGANIZAÇÃO'}</span><strong>{title.slice(0, 1).toUpperCase()}</strong></div>}
      <div className="lore-drawer-badges">
        {data.status && <span className={`lore-pill status-${badgeClass(data.status)}`}>{data.status}</span>}
        {data.priority && data.priority !== 'Normal' && <span className={`lore-pill priority-${badgeClass(data.priority)}`}>{data.priority} prioridade</span>}
        {data.rarity && <span className="lore-pill rarity-pill">{data.rarity}</span>}
        {data.level !== undefined && data.level !== '' && data.level !== null && <span className="lore-pill level-pill">Nível {data.level}</span>}
        {!data.status && !data.priority && !data.rarity && (data.level === undefined || data.level === '') && <span className="lore-pill status-rascunho">Sem classificação</span>}
      </div>
      <section className="lore-form-section">
        <div className="lore-section-heading"><h4>Identidade</h4><span>Organize a ficha</span></div>
        <label className="lore-field"><span>Nome</span><input value={title} onChange={event => update(titleKey, event.target.value)} placeholder="Nome do objeto" /></label>
        <div className="lore-fields-two">
          <label className="lore-field"><span>Status</span><select value={data.status || ''} onChange={event => update('status', event.target.value)}><option value="">Sem status</option><option>Rascunho</option><option>Em andamento</option><option>Planejado</option><option>Em revisão</option><option>Concluído</option><option>Referência</option></select></label>
          <label className="lore-field"><span>Prioridade</span><select value={data.priority || 'Normal'} onChange={event => update('priority', event.target.value)}><option>Normal</option><option>Alta</option><option>Crítica</option><option>Baixa</option></select></label>
        </div>
        <div className="lore-fields-two">
          <label className="lore-field"><span>Raridade</span><select value={data.rarity || ''} onChange={event => update('rarity', event.target.value)}><option value="">Não definida</option><option>Comum</option><option>Incomum</option><option>Raro</option><option>Épico</option><option>Lendário</option><option>Único</option></select></label>
          <label className="lore-field"><span>Nível</span><input type="number" min="0" max="999" value={data.level ?? ''} onChange={event => update('level', event.target.value === '' ? '' : Math.max(0, Number(event.target.value)))} placeholder="—" /></label>
        </div>
        <label className="lore-field"><span>Tags <small>separe por vírgula</small></span><input value={tagsDraft} onChange={event => setTagsDraft(event.target.value)} onBlur={() => updateTags(tagsDraft)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); updateTags(tagsDraft); event.currentTarget.blur() } }} placeholder="Ex.: protagonista, facção, local" /></label>
        <label className="lore-field"><span>Descrição curta</span><textarea rows={4} value={data.loreDescription || ''} onChange={event => update('loreDescription', event.target.value)} placeholder="Resumo, motivação, função narrativa ou observações…" /></label>
      </section>
      <section className="lore-preview-section">
        <div className="lore-section-heading"><h4>Conteúdo no canvas</h4><span>Prévia</span></div>
        <p>{bodyPreview || (node.type === 'image' ? 'Imagem de referência. Use a descrição curta acima para registrar por que ela importa para o projeto.' : node.type === 'table' ? 'Tabela de atributos. Edite as células diretamente no canvas e use esta ficha para classificar a tabela.' : node.type === 'group' ? 'Área de organização. Conecte e agrupe objetos relacionados ao redor desta região.' : 'Ainda não há texto no corpo deste objeto. Você pode escrever diretamente no cartão do mapa mental.')}</p>
        {node.type === 'document' && data.documentId && <button type="button" className="lore-open-document" onClick={onOpenDocument}><ExternalLink size={14} /> Abrir documento completo</button>}
      </section>
    </div>
    <footer className="lore-drawer-footer"><span><span className="lore-save-dot" /> As alterações são salvas automaticamente</span><button type="button" className="action-button primary" onClick={onClose}>Concluir</button></footer>
  </aside>
}

function CanvasFlow({ item, onCanvasChange, onBackHome, onNameChange, onStoreImage, showToast, documents = [], onDocumentContentChange, onDocumentNameChange, onOpenDocument }) {
  const [nodes, setNodes] = useState(() => (item.nodes || []).map(node => ({ ...node, dragHandle: ({ idea: '.idea-node-head', table: '.table-node-title', group: '.group-node-head', image: '.standalone-image', document: '.document-node-head' }[node.type]) || node.dragHandle })))
  const [edges, setEdges] = useState(() => normalizeSavedEdges(item.edges || [], item.nodes || []))
  const [viewport, setViewport] = useState(item.viewport || { x: 0, y: 0, zoom: 1 })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const [tableOpen, setTableOpen] = useState(false)
  const [cardTableOpen, setCardTableOpen] = useState(false)
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false)
  const [activeTextEditor, setActiveTextEditor] = useState(null)
  const [activeTableCell, setActiveTableCell] = useState(null)
  const [detailNodeId, setDetailNodeId] = useState(null)
  useEffect(() => {
    if (!detailNodeId) return undefined
    const closeWithEscape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDetailNodeId(null) }
    }
    window.addEventListener('keydown', closeWithEscape, true)
    return () => window.removeEventListener('keydown', closeWithEscape, true)
  }, [detailNodeId])
  const [editorRevision, setEditorRevision] = useState(0)
  const [copiedCard, setCopiedCard] = useState(null)
  const [paneContext, setPaneContext] = useState(null)
  const [edgeContext, setEdgeContext] = useState(null)
  const [lassoBox, setLassoBox] = useState(null)
  const rightLassoListenersRef = useRef(null)
  const stageRef = useRef(null)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const handleWheel = event => {
      if (!(event.ctrlKey || event.metaKey)) return
      // Prevent browser-page zoom and zoom the map around the pointer instead.
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const current = viewportRef.current || { x: 0, y: 0, zoom: 1 }
      const oldZoom = Math.max(0.05, Number(current.zoom) || 1)
      const zoom = Math.max(0.2, Math.min(5, oldZoom * Math.exp(-event.deltaY * 0.002)))
      const worldX = (pointerX - (current.x || 0)) / oldZoom
      const worldY = (pointerY - (current.y || 0)) / oldZoom
      const next = { x: pointerX - worldX * zoom, y: pointerY - worldY * zoom, zoom }
      viewportRef.current = next
      setViewport(next)
      onCanvasChange({ viewport: next })
    }
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [onCanvasChange])
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const edgesRef = useRef(edges); edgesRef.current = edges
  const copiedCardRef = useRef(copiedCard); copiedCardRef.current = copiedCard
  const textSelectionRef = useRef(null)
  const historyRef = useRef(null)
  if (!historyRef.current) {
    const initial = createCanvasSnapshot(nodes, edges)
    const signature = JSON.stringify(initial)
    historyRef.current = { past: [], future: [], present: initial, presentSignature: signature, pending: initial, pendingSignature: signature, timer: null }
  }
  const imageInputRef = useRef(null)
  const cardImageInputRef = useRef(null)
  const cardFileInputRef = useRef(null)
  const activateTextEditor = useCallback(editor => {
    setActiveTextEditor(editor); setActiveTableCell(null); setEditorRevision(revision => revision + 1)
    if (editor && !editor.isDestroyed && editor.state?.selection) {
      const { from, to } = editor.state.selection
      textSelectionRef.current = { editor, from, to }
    }
  }, [])
  const copyFlowElements = (requestedNodeId = null, silent = false) => {
    const currentNodes = nodesRef.current
    const selectedNodes = currentNodes.filter(node => node.selected)
    let nodesToCopy = selectedNodes
    if (requestedNodeId && !selectedNodes.some(node => node.id === requestedNodeId)) {
      const requested = currentNodes.find(node => node.id === requestedNodeId)
      nodesToCopy = requested ? [requested] : []
    }
    const selectedIds = new Set(nodesToCopy.map(node => node.id))
    const selectedEdges = edgesRef.current.filter(edge =>
      nodesToCopy.length
        ? selectedIds.has(edge.source) && selectedIds.has(edge.target)
        : edge.selected
    )
    if (!nodesToCopy.length && !selectedEdges.length) return null
    const payload = {
      nodes: nodesToCopy.map(node => JSON.parse(JSON.stringify({ ...cloneCanvasNodeForHistory(node), selected: false }))),
      edges: selectedEdges.map(edge => JSON.parse(JSON.stringify({ ...edge, selected: false }))),
    }
    copiedCardRef.current = payload
    setCopiedCard(payload)
    if (!silent) showToast(nodesToCopy.length > 1 ? `${nodesToCopy.length} objetos copiados` : nodesToCopy.length ? 'Objeto copiado' : 'Conexão copiada')
    return payload
  }
  const nodeOps = useMemo(() => ({
    activateTextEditor,
    activateTableCell: (nodeId, row, col) => { setActiveTextEditor(null); setActiveTableCell({ nodeId, row, col }) },
    setTableCellColor: color => { if (!activeTableCell) return; const current = activeTableCell; setNodes(nodesNow => nodesNow.map(node => { if (node.id !== current.nodeId) return node; const rows = node.data?.matrix?.length || 5; const cols = node.data?.matrix?.[0]?.length || 4; const cellColors = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => node.data?.cellColors?.[r]?.[c] || '')); cellColors[current.row][current.col] = color; return { ...node, data: { ...node.data, cellColors } } })); setActiveTableCell({ ...current, color }) },
    updateNodeData: (id, key, value) => setNodes(current => current.map(node => node.id === id ? { ...node, data: { ...node.data, [key]: value } } : node)),
    updateTableCell: (id, rowIndex, colIndex, value) => setNodes(current => current.map(node => {
      if (node.id !== id || node.type !== 'table') return node
      const oldMatrix = node.data?.matrix || Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ''))
      const matrix = oldMatrix.map(row => [...row])
      while (matrix.length <= rowIndex) matrix.push([])
      while (matrix[rowIndex].length <= colIndex) matrix[rowIndex].push('')
      if (matrix[rowIndex][colIndex] === value) return node
      matrix[rowIndex][colIndex] = value
      return { ...node, data: { ...node.data, matrix } }
    })),
    updateCardContent: (id, richContent, text) => setNodes(current => current.map(node => { if (node.id !== id) return node; if (node.data?.richContent === richContent && node.data?.text === text) return node; return { ...node, data: { ...node.data, richContent, text } } })),
    updateDocumentCardContent: (nodeId, documentId, richContent) => {
      setNodes(current => current.map(node => node.id === nodeId && node.data?.richContent !== richContent ? { ...node, data: { ...node.data, richContent } } : node))
      if (documentId) onDocumentContentChange?.(documentId, richContent)
    },
    renameLinkedDocument: (documentId, name) => { if (documentId && name) onDocumentNameChange?.(documentId, name) },
    openLinkedDocument: documentId => { if (documentId) onOpenDocument?.(documentId) },
    growNodeTo: (id, height) => setNodes(current => current.map(node => {
      if (node.id !== id) return node
      const currentHeight = Number(node.style?.height || node.height || node.measured?.height) || 230
      if (height <= currentHeight + 2) return node
      return { ...node, height, style: { ...node.style, height } }
    })),
    copyNode: id => {
      copyFlowElements(id, true)
      showToast('Objeto copiado. Use Ctrl+V ou clique com o botão direito no quadro para colar.')
    },
    patchNode: (id, patch) => setNodes(current => current.map(node => node.id === id ? { ...node, ...patch } : node)),
    deleteNode: id => { activateTextEditor(null); setNodes(current => current.filter(node => node.id !== id)); setEdges(current => current.filter(edge => edge.source !== id && edge.target !== id)) },
    openNodeDetails: id => { activateTextEditor(null); setActiveTableCell(null); setDetailNodeId(id); setPaneContext(null); setEdgeContext(null) },
    storeImage: onStoreImage, toast: showToast,
  }), [activateTextEditor, activeTableCell, onStoreImage, showToast, onDocumentContentChange, onDocumentNameChange, onOpenDocument])
  useEffect(() => {
    if (!documents?.length) return
    const byId = new Map(documents.map(doc => [doc.id, doc]))
    setNodes(current => {
      let changed = false
      const next = current.map(node => {
        if (node.type !== 'document' || !node.data?.documentId) return node
        const source = byId.get(node.data.documentId)
        if (!source) return node
        const patch = {}
        if (source.name && source.name !== node.data.title) patch.title = source.name
        if (typeof source.content === 'string' && source.content !== node.data.richContent) patch.richContent = source.content
        if (!Object.keys(patch).length) return node
        changed = true
        return { ...node, data: { ...node.data, ...patch } }
      })
      return changed ? next : current
    })
  }, [documents])
  useEffect(() => { onCanvasChange({ nodes, edges }) }, [nodes, edges, onCanvasChange])
  useEffect(() => {
    const history = historyRef.current
    const next = createCanvasSnapshot(nodes, edges)
    const signature = JSON.stringify(next)
    history.pending = next
    history.pendingSignature = signature
    if (history.timer) clearTimeout(history.timer)
    if (signature === history.presentSignature) { history.timer = null; return undefined }
    history.timer = setTimeout(() => {
      if (history.pendingSignature !== history.presentSignature) {
        history.past.push(history.present)
        if (history.past.length > 80) history.past.shift()
        history.present = history.pending
        history.presentSignature = history.pendingSignature
        history.future = []
      }
      history.timer = null
    }, 350)
    return () => { if (history.timer) clearTimeout(history.timer) }
  }, [nodes, edges])
  useEffect(() => () => { if (historyRef.current?.timer) clearTimeout(historyRef.current.timer) }, [])
  const onNodesChange = useCallback(changes => setNodes(current => {
    const previousData = new Map(current.filter(node => changes.some(change => change.id === node.id && (change.type === 'dimensions' || change.type === 'position'))).map(node => [node.id, node.data]))
    const next = applyNodeChanges(changes, current)
    // Resizing/moving is layout-only; never replace an editor's content data during those events.
    return next.map(node => previousData.has(node.id) ? { ...node, data: previousData.get(node.id) } : node)
  }), [])
  const onEdgesChange = useCallback(changes => setEdges(current => applyEdgeChanges(changes, current)), [])
  const onEdgeClick = useCallback((event, edge) => {
    event.stopPropagation()
    setNodes(current => current.map(node => node.selected ? { ...node, selected: false } : node))
    setEdges(current => current.map(candidate => ({ ...candidate, selected: candidate.id === edge.id })))
    setActiveTextEditor(null); setActiveTableCell(null)
    // Put keyboard focus on the board so Delete removes the selected edge,
    // rather than deleting text in an editor that was focused previously.
    requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }))
  }, [])
  const onConnect = useCallback(params => setEdges(current => addEdge({ ...params, type: 'smoothstep', reconnectable: true, interactionWidth: 30, selectable: true, deletable: true, style: { stroke: '#7d988b', strokeWidth: 2 } }, current)), [])
  // Existing connectors can be grabbed at either endpoint and attached to a
  // different side/node. Preserve their ID so selection/history stays stable.
  const onReconnect = useCallback((oldEdge, newConnection) => {
    setEdges(current => reconnectEdge(oldEdge, newConnection, current, { shouldReplaceId: false }).map(edge => ({ ...edge, type: 'smoothstep', reconnectable: true })))
  }, [])
  const onStageContextMenu = event => {
    if (event.target?.closest?.('.react-flow__node, .react-flow__edge, .react-flow__controls')) return
    event.preventDefault?.(); event.stopPropagation?.()
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const zoom = Math.max(0.05, viewport.zoom || 1)
    const position = { x: (event.clientX - rect.left - (viewport.x || 0)) / zoom, y: (event.clientY - rect.top - (viewport.y || 0)) / zoom }
    setPaneContext({ x: event.clientX, y: event.clientY, flowPosition: position })
  }

  const removeRightLassoListeners = useCallback(() => {
    const listeners = rightLassoListenersRef.current
    if (!listeners) return
    document.removeEventListener('pointermove', listeners.move, true)
    document.removeEventListener('pointerup', listeners.up, true)
    document.removeEventListener('pointercancel', listeners.cancel, true)
    window.removeEventListener('blur', listeners.cancel, true)
    rightLassoListenersRef.current = null
  }, [])
  useEffect(() => () => removeRightLassoListeners(), [removeRightLassoListeners])

  const commitRightLasso = (gesture, endX, endY) => {
    const stage = stageRef.current
    const stageRect = stage?.getBoundingClientRect()
    if (!stage || !stageRect) return
    const rect = {
      left: Math.min(gesture.startX, endX), top: Math.min(gesture.startY, endY),
      right: Math.max(gesture.startX, endX), bottom: Math.max(gesture.startY, endY),
    }
    const nodeDom = new Map(Array.from(stage.querySelectorAll('.react-flow__node')).map(element => [element.getAttribute('data-id'), element]))
    const selectedNodeIds = new Set()
    for (const node of nodesRef.current) {
      const element = nodeDom.get(node.id)
      const bounds = element ? (() => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })() : nodeClientRect(node, stageRect, viewport)
      if (rectsIntersect(bounds, rect)) selectedNodeIds.add(node.id)
    }

    const edgeDom = new Map(Array.from(stage.querySelectorAll('.react-flow__edge')).map(element => [element.getAttribute('data-id'), element]))
    const selectedEdgeIds = new Set()
    for (const edge of edgesRef.current) {
      const group = edgeDom.get(edge.id)
      const path = group?.querySelector('.react-flow__edge-path') || group?.querySelector('path')
      let intersects = svgPathIntersectsRect(path, rect)
      if (!path) {
        const sourceNode = nodesRef.current.find(node => node.id === edge.source)
        const targetNode = nodesRef.current.find(node => node.id === edge.target)
        if (sourceNode && targetNode) {
          const a = nodeDom.get(sourceNode.id)?.getBoundingClientRect() || nodeClientRect(sourceNode, stageRect, viewport)
          const b = nodeDom.get(targetNode.id)?.getBoundingClientRect() || nodeClientRect(targetNode, stageRect, viewport)
          const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2
          const bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2
          const distance = Math.hypot(bx - ax, by - ay)
          const steps = Math.max(1, Math.ceil(distance / 4))
          for (let i = 0; i <= steps; i++) {
            const ratio = i / steps, x = ax + (bx - ax) * ratio, y = ay + (by - ay) * ratio
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) { intersects = true; break }
          }
        }
      }
      if (intersects) selectedEdgeIds.add(edge.id)
    }
    setNodes(current => current.map(node => ({ ...node, selected: selectedNodeIds.has(node.id) })))
    setEdges(current => current.map(edge => ({ ...edge, selected: selectedEdgeIds.has(edge.id) })))
    setActiveTextEditor(null); setActiveTableCell(null); setPaneContext(null); setLassoBox(null)
    requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }))
    showToast(`${selectedNodeIds.size} objetos e ${selectedEdgeIds.size} conexões selecionados`)
  }

  const onStagePointerDownCapture = event => {
    if (event.button !== 2) return
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest('.react-flow__node, .react-flow__controls, .canvas-toolbar, .canvas-format-row, .atlas-menu-surface')) return
    // The gesture starts on the empty pane. Node-specific context menus keep their behavior.
    if (target.closest('.react-flow__edge')) return
    event.preventDefault()
    event.stopPropagation()
    removeRightLassoListeners()
    const gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, dragging: false }
    const move = moveEvent => {
      if (moveEvent.pointerId !== gesture.pointerId) return
      gesture.lastX = moveEvent.clientX; gesture.lastY = moveEvent.clientY
      const distance = Math.hypot(gesture.lastX - gesture.startX, gesture.lastY - gesture.startY)
      if (!gesture.dragging && distance >= 5) { gesture.dragging = true; setPaneContext(null) }
      if (!gesture.dragging) return
      moveEvent.preventDefault()
      const stageRect = stageRef.current?.getBoundingClientRect()
      if (!stageRect) return
      setLassoBox({
        left: Math.min(gesture.startX, gesture.lastX) - stageRect.left,
        top: Math.min(gesture.startY, gesture.lastY) - stageRect.top,
        width: Math.max(1, Math.abs(gesture.lastX - gesture.startX)),
        height: Math.max(1, Math.abs(gesture.lastY - gesture.startY)),
      })
    }
    const finish = upEvent => {
      if (upEvent?.pointerId != null && upEvent.pointerId !== gesture.pointerId) return
      removeRightLassoListeners()
      if (gesture.dragging) commitRightLasso(gesture, upEvent?.clientX ?? gesture.lastX, upEvent?.clientY ?? gesture.lastY)
      else {
        setLassoBox(null)
        onStageContextMenu({ target: stageRef.current, clientX: gesture.startX, clientY: gesture.startY, preventDefault() {}, stopPropagation() {} })
      }
    }
    const cancel = () => {
      removeRightLassoListeners()
      setLassoBox(null)
    }
    rightLassoListenersRef.current = { move, up: finish, cancel }
    document.addEventListener('pointermove', move, { capture: true, passive: false })
    document.addEventListener('pointerup', finish, true)
    document.addEventListener('pointercancel', cancel, true)
    window.addEventListener('blur', cancel, true)
  }
  const pasteClipboard = ({ flowPosition = null, offset = null } = {}) => {
    const payload = copiedCardRef.current
    if (!payload) return
    // Backward compatibility for an older in-memory single-card clipboard.
    let copiedNodes = Array.isArray(payload.nodes) ? payload.nodes : payload.data ? [{ id: makeId(), type: 'idea', position: { x: 0, y: 0 }, data: payload.data, style: { width: payload.width || 290, height: payload.height || 230 } }] : []
    const copiedEdges = Array.isArray(payload.edges) ? payload.edges : []
    const currentNodes = nodesRef.current
    const currentIds = new Set(currentNodes.map(node => node.id))
    const minX = copiedNodes.length ? Math.min(...copiedNodes.map(node => Number(node.position?.x) || 0)) : 0
    const minY = copiedNodes.length ? Math.min(...copiedNodes.map(node => Number(node.position?.y) || 0)) : 0
    let dx = Number(offset?.x) || 0
    let dy = Number(offset?.y) || 0
    if (flowPosition && copiedNodes.length) { dx = flowPosition.x - minX; dy = flowPosition.y - minY }
    else if (!offset && copiedNodes.length) {
      const rect = stageRef.current?.getBoundingClientRect()
      const selected = currentNodes.filter(node => node.selected)
      if (selected.length) {
        dx = Math.max(...selected.map(node => (Number(node.position?.x) || 0) + (Number(node.measured?.width || node.width || node.style?.width) || 280))) - minX + 32
        dy = Math.min(...selected.map(node => Number(node.position?.y) || 0)) - minY + 32
      } else {
        const z = Math.max(0.05, viewport.zoom || 1)
        dx = ((rect?.width || 800) / 2 - (viewport.x || 0)) / z - minX
        dy = ((rect?.height || 600) / 2 - (viewport.y || 0)) / z - minY
      }
    }
    const idMap = new Map(copiedNodes.map(node => [node.id, makeId()]))
    const newNodes = copiedNodes.map((node, index) => {
      const data = JSON.parse(JSON.stringify(node.data || {}))
      if (data.title) data.title = `${data.title} (cópia)`
      else if (data.name) data.name = `${data.name} (cópia)`
      const style = { ...(node.style || {}) }
      const clone = { ...JSON.parse(JSON.stringify(node)), id: idMap.get(node.id) || makeId(), type: node.type || 'idea', data, position: { x: (Number(node.position?.x) || 0) + dx, y: (Number(node.position?.y) || 0) + dy }, style, selected: true, dragging: false }
      delete clone.internals; delete clone.positionAbsolute; delete clone.measured
      clone.dragHandle = ({ idea: '.idea-node-head', table: '.table-node-title', group: '.group-node-head', image: '.standalone-image', document: '.document-node-head' }[clone.type]) || clone.dragHandle
      return clone
    })
    const newIds = new Set([...currentIds, ...newNodes.map(node => node.id)])
    const newEdges = copiedEdges.filter(edge => newIds.has(idMap.get(edge.source) || edge.source) && newIds.has(idMap.get(edge.target) || edge.target)).map(edge => ({
      ...JSON.parse(JSON.stringify(edge)), id: makeId(), source: idMap.get(edge.source) || edge.source, target: idMap.get(edge.target) || edge.target,
      selected: copiedNodes.length === 0, interactionWidth: Math.max(18, Number(edge.interactionWidth) || 28),
    }))
    if (newNodes.length) setNodes(current => [...current.map(node => ({ ...node, selected: false })), ...newNodes])
    if (newEdges.length) setEdges(current => [...current.map(edge => ({ ...edge, selected: false })), ...newEdges])
    if (!newNodes.length && !newEdges.length) { showToast('Não há objetos válidos para colar.'); return }
    setPaneContext(null)
    showToast(newNodes.length > 1 ? `${newNodes.length} objetos colados` : newNodes.length ? 'Objeto colado' : 'Conexão colada')
  }
  const pasteCopiedCard = () => pasteClipboard({ flowPosition: paneContext?.flowPosition || null })
  const onMoveEnd = useCallback((_, nextViewport) => { viewportRef.current = nextViewport; setViewport(nextViewport); onCanvasChange({ viewport: nextViewport }) }, [onCanvasChange])
  const addNode = (type, extra = {}) => {
    const current = viewport
    let data, width, height
    if (type === 'idea') { data = { title: 'Novo cartão', text: '', richContent: '<p></p>', status: 'Em andamento', priority: 'Normal', tags: [] }; width = 290; height = 230 }
    if (type === 'image') { data = { name: 'Imagem', src: '', objectFit: 'contain', naturalWidth: 260, naturalHeight: 180 }; width = 260; height = 180 }
    if (type === 'table') { const rows = extra.rows || 5, cols = extra.cols || 4; data = { title: 'Tabela', matrix: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')), cellColors: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')) }; width = 390; height = 270 }
    if (type === 'group') { data = { title: 'Novo grupo' }; width = 300; height = 220 }
    if (type === 'document') { data = { title: 'Documento', documentId: null, richContent: '<p></p>' }; width = 430; height = 520 }
    const stageRect = stageRef.current?.getBoundingClientRect()
    const stageWidth = stageRect?.width || window.innerWidth
    const stageHeight = stageRect?.height || window.innerHeight
    const zoom = Math.max(0.05, current.zoom || 1)
    const centered = { x: (stageWidth / 2 - (current.x || 0)) / zoom - (width || 280) / 2, y: (stageHeight / 2 - (current.y || 0)) / zoom - (height || 180) / 2 }
    const count = nodesRef.current.length
    const offset = { x: centered.x + ((count % 3) * 28), y: centered.y + ((count % 3) * 28) }
    setNodes(currentNodes => [...currentNodes, makeAtlasNode(type, offset, { ...data, ...(extra.data || {}) }, width, height)])
  }
  const addUploadedImage = async file => {
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Selecione uma imagem.'); return }
    try {
      const src = await readImageForAtlas(file)
      const info = await new Promise(resolve => { const img = new window.Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = () => resolve({ width: 260, height: 180 }); img.src = src })
      onStoreImage(file.name, src)
      addNode('image', { data: { src, name: file.name, naturalWidth: info.width, naturalHeight: info.height } })
    } catch { showToast('Não foi possível abrir a imagem.') }
    if (imageInputRef.current) imageInputRef.current.value = ''
  }
  const insertImageIntoCard = async file => {
    if (!file || !activeTextEditor) return
    if (!file.type.startsWith('image/')) { showToast('Selecione um arquivo de imagem.'); return }
    try {
      const src = await readImageForAtlas(file)
      const dimensions = await new Promise(resolve => { const probe = new window.Image(); probe.onload = () => resolve({ width: probe.naturalWidth || 640, height: probe.naturalHeight || 420 }); probe.onerror = () => resolve({ width: 640, height: 420 }); probe.src = src })
      const frameWidth = Math.min(620, dimensions.width)
      const frameHeight = Math.round(frameWidth * dimensions.height / Math.max(1, dimensions.width))
      activeTextEditor.chain().focus().setImage({ src, alt: file.name, title: file.name, imageId: makeId(), align: 'left', widthPct: 42, frameHeight: Math.max(60, Math.min(240, frameHeight)), naturalWidth: dimensions.width, naturalHeight: dimensions.height, objectFit: 'contain' }).run()
      onStoreImage?.(file.name, src)
    } catch { showToast('Não foi possível inserir a imagem no cartão.') }
    if (cardImageInputRef.current) cardImageInputRef.current.value = ''
  }
  const insertFileIntoCard = async file => {
    if (!file || !activeTextEditor) return
    if (file.size > 600_000) { showToast('Escolha um arquivo de até 600 KB.'); return }
    try {
      const src = await readFileAsDataURL(file)
      const safeName = file.name.replace(/[&<>"']/g, '')
      activeTextEditor.chain().focus().insertContent(`<p><a href="${src}" download="${safeName}" target="_blank" rel="noopener noreferrer">ðŸ“Ž ${safeName}</a></p>`).run()
    } catch { showToast('Não foi possível anexar o arquivo.') }
    if (cardFileInputRef.current) cardFileInputRef.current.value = ''
  }
  const clearSelection = () => { setActiveTextEditor(null); setActiveTableCell(null); setNodes(current => current.map(node => ({ ...node, selected: false }))); setEdges(current => current.map(edge => ({ ...edge, selected: false }))); setPaneContext(null) }
  const removeSelectedCanvasElements = () => {
    const selectedNodeIds = new Set(nodesRef.current.filter(node => node.selected).map(node => node.id))
    const selectedEdgeIds = new Set(edgesRef.current.filter(edge => edge.selected).map(edge => edge.id))
    if (!selectedNodeIds.size && !selectedEdgeIds.size) return false
    setNodes(current => current.filter(node => !selectedNodeIds.has(node.id)))
    setEdges(current => current.filter(edge => !selectedEdgeIds.has(edge.id) && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target)))
    setActiveTextEditor(null); setActiveTableCell(null)
    return true
  }
  const restoreCanvasSnapshot = snapshot => {
    const restoredNodes = snapshot.nodes.map(node => ({ ...JSON.parse(JSON.stringify(node)), selected: false, dragging: false }))
    const restoredEdges = snapshot.edges.map(edge => ({ ...JSON.parse(JSON.stringify(edge)), selected: false }))
    setNodes(restoredNodes); setEdges(restoredEdges)
    nodesRef.current = restoredNodes; edgesRef.current = restoredEdges
  }
  const undoCanvas = () => {
    const history = historyRef.current
    if (history.timer) clearTimeout(history.timer)
    history.timer = null
    if (history.pendingSignature !== history.presentSignature) {
      history.future.push(history.pending)
      history.pending = history.present; history.pendingSignature = history.presentSignature
      restoreCanvasSnapshot(history.present)
      return true
    }
    if (!history.past.length) return false
    history.future.push(history.present)
    history.present = history.past.pop()
    history.presentSignature = JSON.stringify(history.present)
    history.pending = history.present; history.pendingSignature = history.presentSignature
    restoreCanvasSnapshot(history.present)
    return true
  }
  const redoCanvas = () => {
    const history = historyRef.current
    if (history.timer) clearTimeout(history.timer)
    history.timer = null
    if (history.pendingSignature !== history.presentSignature || !history.future.length) return false
    history.past.push(history.present)
    history.present = history.future.pop()
    history.presentSignature = JSON.stringify(history.present)
    history.pending = history.present; history.pendingSignature = history.presentSignature
    restoreCanvasSnapshot(history.present)
    return true
  }
  useEffect(() => {
    const handler = event => {
      const target = event.target
      const mod = event.ctrlKey || event.metaKey
      const key = String(event.key || '').toLowerCase()
      const editableTarget = isEditableEventTarget(target)
      const toolbarTarget = target instanceof Element && Boolean(target.closest('.canvas-format-row'))
      const toolbarTextContext = toolbarTarget && activeTextEditor && !activeTextEditor.isDestroyed
      const bookmark = textSelectionRef.current
      const restoreEditorChain = editor => {
        let chain = editor.chain().focus()
        if (bookmark?.editor === editor && Number.isInteger(bookmark.from) && Number.isInteger(bookmark.to) && bookmark.from >= 0 && bookmark.to <= editor.state.doc.content.size) {
          chain = chain.setTextSelection({ from: bookmark.from, to: bookmark.to })
        }
        return chain
      }
      if (toolbarTextContext && mod && ['a','b','i','u','z','y','c','x','v'].includes(key)) {
        const editor = activeTextEditor
        if (key === 'b' || key === 'i' || key === 'u') {
          event.preventDefault()
          const chain = restoreEditorChain(editor)
          if (key === 'b') chain.toggleBold().run()
          if (key === 'i') chain.toggleItalic().run()
          if (key === 'u') chain.toggleUnderline().run()
          return
        }
        if (key === 'z') { event.preventDefault(); if (event.shiftKey) restoreEditorChain(editor).redo().run(); else restoreEditorChain(editor).undo().run(); return }
        if (key === 'y') { event.preventDefault(); restoreEditorChain(editor).redo().run(); return }
        const from = bookmark?.editor === editor ? bookmark.from : editor.state.selection.from
        const to = bookmark?.editor === editor ? bookmark.to : editor.state.selection.to
        if (key === 'a') { event.preventDefault(); restoreEditorChain(editor).selectAll().run(); return }
        if ((key === 'c' || key === 'x') && to > from) {
          event.preventDefault()
          const text = editor.state.doc.textBetween(from, to, '\n')
          navigator.clipboard?.writeText(text).catch(() => {})
          if (key === 'x') restoreEditorChain(editor).deleteRange({ from, to }).run()
          return
        }
        if (key === 'v') {
          event.preventDefault()
          // Use the same single-line normalization as the native paste handler
          // (handleInlineTextPaste) so this toolbar-context shortcut never
          // breaks pasted text into separate paragraphs/lines again.
          if (navigator.clipboard?.readText) navigator.clipboard.readText().then(text => {
            if (!text) return
            const max = editor.state.doc.content.size
            const safeFrom = Math.max(0, Math.min(max, from))
            const safeTo = Math.max(safeFrom, Math.min(max, to))
            editor.chain().focus().insertContentAt({ from: safeFrom, to: safeTo }, normalizeClipboardInlineText(text)).run()
          }).catch(() => showToast('Não foi possível ler a área de transferência.'))
          else showToast('A colagem por atalho requer acesso à área de transferência do navegador.')
          return
        }
      }
      // Inside editable text, leave copy/cut/paste/select-all/format/undo to the editor.
      if (editableTarget) return
      if (event.key === 'Escape') { setPaneContext(null); clearSelection(); return }
      if (mod && key === 's') return // The app-level save shortcut handles this.
      if (mod && key === 'k') return // The app-level search shortcut handles this.
      if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redoCanvas(); else undoCanvas(); return }
      if (mod && key === 'y') { event.preventDefault(); redoCanvas(); return }
      if (mod && key === 'a') {
        event.preventDefault()
        setNodes(current => current.map(node => ({ ...node, selected: true })))
        setEdges(current => current.map(edge => ({ ...edge, selected: true })))
        setActiveTextEditor(null); setActiveTableCell(null)
        return
      }
      if (mod && key === 'c') {
        const payload = copyFlowElements(null, true)
        if (payload) { event.preventDefault(); showToast(payload.nodes.length > 1 ? `${payload.nodes.length} objetos copiados` : payload.nodes.length ? 'Objeto copiado' : 'Conexão copiada') }
        return
      }
      if (mod && key === 'x') {
        const payload = copyFlowElements(null, true)
        if (payload) { event.preventDefault(); removeSelectedCanvasElements(); showToast('Recortado') }
        return
      }
      if (mod && key === 'v') {
        if (copiedCardRef.current) { event.preventDefault(); pasteClipboard() }
        return
      }
      if (mod && key === 'd') {
        const payload = copyFlowElements(null, true)
        if (payload) { event.preventDefault(); pasteClipboard({ offset: { x: 32, y: 32 } }) }
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (removeSelectedCanvasElements()) event.preventDefault()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activeTextEditor, showToast, pasteClipboard, copyFlowElements, undoCanvas, redoCanvas, removeSelectedCanvasElements, clearSelection, viewport])
  useEffect(() => {
    const removeNode = id => {
      if (!id) return
      setNodes(current => current.filter(node => node.id !== id))
      setEdges(current => current.filter(edge => edge.source !== id && edge.target !== id))
      setActiveTextEditor(null); setActiveTableCell(null)
    }
    const onDelete = event => event.detail?.id ? removeNode(event.detail.id) : removeSelectedCanvasElements()
    const onCopy = event => copyFlowElements(event.detail?.id || null, true)
    const onPaste = () => pasteClipboard()
    const onSelectAll = () => {
      setNodes(current => current.map(node => ({ ...node, selected: true })))
      setEdges(current => current.map(edge => ({ ...edge, selected: true })))
    }
    window.addEventListener('atlas:context-delete', onDelete)
    window.addEventListener('atlas:context-copy', onCopy)
    window.addEventListener('atlas:context-paste', onPaste)
    window.addEventListener('atlas:context-select-all', onSelectAll)
    return () => {
      window.removeEventListener('atlas:context-delete', onDelete)
      window.removeEventListener('atlas:context-copy', onCopy)
      window.removeEventListener('atlas:context-paste', onPaste)
      window.removeEventListener('atlas:context-select-all', onSelectAll)
    }
  }, [copyFlowElements, pasteClipboard, removeSelectedCanvasElements])
  const selectedTableNode = activeTableCell ? nodes.find(node => node.id === activeTableCell.nodeId) : null
  const tableCellFormatTarget = activeTableCell && selectedTableNode ? { ...activeTableCell, color: selectedTableNode.data?.cellColors?.[activeTableCell.row]?.[activeTableCell.col] || activeTableCell.color || '#252a27' } : null
  const tableCreated = (rows, cols) => addNode('table', { rows, cols })
  const cardTableCreated = (rows, cols) => activeTextEditor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
  const zoomBy = factor => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const current = viewportRef.current || { x: 0, y: 0, zoom: 1 }
    const oldZoom = Math.max(0.05, Number(current.zoom) || 1)
    const nextZoom = Math.max(0.2, Math.min(5, oldZoom * factor))
    const cx = rect.width / 2, cy = rect.height / 2
    const next = { x: cx - ((cx - (current.x || 0)) / oldZoom) * nextZoom, y: cy - ((cy - (current.y || 0)) / oldZoom) * nextZoom, zoom: nextZoom }
    viewportRef.current = next
    setViewport(next)
    onCanvasChange({ viewport: next })
  }
  const fitCanvas = () => {
    const rect = stageRef.current?.getBoundingClientRect()
    const currentNodes = nodesRef.current
    if (!rect || !currentNodes.length) {
      const next = { x: 0, y: 0, zoom: 1 }; viewportRef.current = next; setViewport(next); onCanvasChange({ viewport: next }); return
    }
    const bounds = currentNodes.reduce((b, node) => {
      const x = Number(node.position?.x) || 0, y = Number(node.position?.y) || 0
      const width = Number(node.measured?.width || node.width || node.style?.width) || ({ image: 260, table: 390, document: 430, group: 300 }[node.type] || 290)
      const height = Number(node.measured?.height || node.height || node.style?.height) || ({ image: 180, table: 270, document: 520, group: 220 }[node.type] || 230)
      return { left: Math.min(b.left, x), top: Math.min(b.top, y), right: Math.max(b.right, x + width), bottom: Math.max(b.bottom, y + height) }
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
    const width = Math.max(1, bounds.right - bounds.left), height = Math.max(1, bounds.bottom - bounds.top)
    const zoom = Math.max(0.2, Math.min(1.5, (rect.width - 100) / width, (rect.height - 100) / height))
    const next = { x: (rect.width - width * zoom) / 2 - bounds.left * zoom, y: (rect.height - height * zoom) / 2 - bounds.top * zoom, zoom }
    viewportRef.current = next
    setViewport(next)
    onCanvasChange({ viewport: next })
  }
  return <section className="canvas-workspace">
    <div className="canvas-toolbar">
      <div className="canvas-crumb"><button className="back-button" onClick={onBackHome} title="Voltar ao início"><ArrowLeft size={15} /></button><span className="crumb-divider">/</span><Network size={15} /><EditableName name={item.name} onSave={onNameChange} className="canvas-editable-title" title="Renomear mapa mental" /></div>
      <div className="canvas-actions">
        <ActionButton icon={Plus} variant="primary" onClick={() => addNode('idea')}>Cartão</ActionButton>
        <button type="button" className="icon-button" title="Adicionar imagem ao mapa" aria-label="Adicionar imagem ao mapa" onClick={() => imageInputRef.current?.click()}><ImageIcon size={16} /></button>
        <input ref={imageInputRef} hidden type="file" accept="image/*" onChange={e => addUploadedImage(e.target.files?.[0])} />
        <button type="button" className="icon-button" title="Nova tabela" aria-label="Nova tabela" onClick={() => setTableOpen(true)}><Table2 size={16} /></button>
        <button type="button" className="icon-button" title="Inserir documento no mapa" aria-label="Inserir documento no mapa" onClick={() => setDocumentPickerOpen(true)}><FilePlus2 size={16} /></button>
        <button type="button" className="icon-button" title="Criar grupo" aria-label="Criar grupo" onClick={() => addNode('group')}><Plus size={16} /></button>
        <span className="canvas-toolbar-divider" />
        <button type="button" className="icon-button" title="Desfazer · Ctrl+Z" aria-label="Desfazer" onClick={undoCanvas}><Undo2 size={15} /></button>
        <button type="button" className="icon-button" title="Refazer · Ctrl+Shift+Z" aria-label="Refazer" onClick={redoCanvas}><Redo2 size={15} /></button>
        <span className="canvas-toolbar-divider" />
        <button type="button" className="icon-button" title="Ajustar o mapa à janela" aria-label="Ajustar mapa à janela" onClick={fitCanvas}><Maximize2 size={15} /></button>
        <button type="button" className="icon-button" title="Diminuir zoom" aria-label="Diminuir zoom" onClick={() => zoomBy(1 / 1.15)}><Minus size={15} /></button>
        <button type="button" className="canvas-zoom-readout" title="Zoom atual; clique para ajustar o mapa" onClick={fitCanvas}>{Math.round((viewport.zoom || 1) * 100)}%</button>
        <button type="button" className="icon-button" title="Aumentar zoom" aria-label="Aumentar zoom" onClick={() => zoomBy(1.15)}><ZoomIn size={15} /></button>
        <button type="button" className="icon-button" title="Limpar seleção" aria-label="Limpar seleção" onClick={clearSelection}><X size={15} /></button>
      </div>
    </div>
    <div className="canvas-format-row" data-editor-revision={editorRevision} aria-label="Formatação de texto do canvas"><TextFormattingControls editor={activeTextEditor} compact tableCell={tableCellFormatTarget} onTableCellColorChange={nodeOps.setTableCellColor} /><InsertMenu editor={activeTextEditor} onPickImage={activeTextEditor ? () => cardImageInputRef.current?.click() : undefined} onPickFile={activeTextEditor ? () => cardFileInputRef.current?.click() : undefined} onOpenTable={activeTextEditor ? () => setCardTableOpen(true) : undefined} onPickDocument={() => setDocumentPickerOpen(true)} /></div>
    <input ref={cardImageInputRef} hidden type="file" accept="image/*" onChange={event => insertImageIntoCard(event.target.files?.[0])} /><input ref={cardFileInputRef} hidden type="file" onChange={event => insertFileIntoCard(event.target.files?.[0])} />
    <div className="canvas-board-row">
      <aside className="canvas-tool-rail" aria-label="Ferramentas do mapa mental">
        <div className="canvas-tool-rail-group">
          <button type="button" className="canvas-tool active" title="Selecionar e mover objetos" aria-label="Selecionar e mover objetos" onClick={clearSelection}><MousePointer2 size={17} /><span>Selecionar</span></button>
          <button type="button" className="canvas-tool" title="Criar cartão" aria-label="Criar cartão" onClick={() => addNode('idea')}><Square size={17} /><span>Cartão</span></button>
          <button type="button" className="canvas-tool" title="Adicionar imagem" aria-label="Adicionar imagem" onClick={() => imageInputRef.current?.click()}><ImageIcon size={17} /><span>Imagem</span></button>
          <button type="button" className="canvas-tool" title="Criar tabela" aria-label="Criar tabela" onClick={() => setTableOpen(true)}><Table2 size={17} /><span>Tabela</span></button>
          <button type="button" className="canvas-tool" title="Criar grupo" aria-label="Criar grupo" onClick={() => addNode('group')}><Layers3 size={17} /><span>Grupo</span></button>
          <button type="button" className="canvas-tool" title="Vincular documento" aria-label="Vincular documento" onClick={() => setDocumentPickerOpen(true)}><FilePlus2 size={17} /><span>Documento</span></button>
        </div>
        <div className="canvas-tool-rail-bottom"><span className="tool-rail-caption">CANVAS</span></div>
      </aside>
      <div className="canvas-stage" ref={stageRef} tabIndex={0}
      onPointerDownCapture={onStagePointerDownCapture}
      onMouseDownCapture={event => {
        if (!isEditableEventTarget(event.target)) {
          const focused = document.activeElement
          if (focused instanceof HTMLElement && focused !== stageRef.current) focused.blur()
          stageRef.current?.focus({ preventScroll: true })
        }
      }} onContextMenu={onStageContextMenu}>
      {nodes.length === 0 && <div className="canvas-empty"><span className="canvas-empty-icon"><Network size={22} /></span><h3>Canvas vazio</h3><p>Adicione cartões, imagens, tabelas e grupos. Conecte os objetos para mapear suas ideias.</p><button className="action-button primary" onClick={() => addNode('idea')}><Plus size={15} /> Criar primeiro cartão</button></div>}
      <NodeOperationsContext.Provider value={nodeOps}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onReconnect={onReconnect} edgesReconnectable reconnectRadius={28} connectionRadius={26} onPaneClick={() => { setActiveTextEditor(null); setActiveTableCell(null); setPaneContext(null); setEdgeContext(null) }} onEdgeClick={onEdgeClick} onEdgeContextMenu={(event, edge) => { event.preventDefault(); event.stopPropagation(); setEdges(current => current.map(entry => ({ ...entry, selected: entry.id === edge.id }))); setEdgeContext({ x: event.clientX, y: event.clientY, id: edge.id }) }} viewport={viewport} onViewportChange={nextViewport => { viewportRef.current = nextViewport; setViewport(nextViewport) }} zoomOnScroll={false} onInit={instance => { if (!item.viewport && nodes.length > 0) requestAnimationFrame(() => instance.fitView({ padding: 0.22, maxZoom: 1 })) }} onMoveEnd={onMoveEnd} deleteKeyCode={null} selectionOnDrag selectionMode="partial" panOnDrag={[1, 2]} multiSelectionKeyCode="Shift" selectionKeyCode="Shift" snapToGrid snapGrid={[20, 20]} defaultEdgeOptions={{ type: 'smoothstep', reconnectable: true, selectable: true, deletable: true, interactionWidth: 28, style: { stroke: '#7d988b', strokeWidth: 2 } }} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--flow-dot)" />
        </ReactFlow>
      </NodeOperationsContext.Provider>
      {lassoBox && <div className="atlas-lasso-box" aria-hidden="true" style={lassoBox} />}
      {paneContext && <ImageContextMenu position={paneContext} ariaLabel="Opções do quadro" onClose={() => setPaneContext(null)} actions={[
        { label: 'Copiar seleção', icon: Copy, onSelect: () => copyFlowElements(null) },
        { label: 'Colar objeto(s) · Ctrl+V', icon: ClipboardPaste, disabled: !(copiedCardRef.current && ((copiedCardRef.current.nodes?.length) || (copiedCardRef.current.edges?.length) || copiedCardRef.current.data)), onSelect: pasteCopiedCard },
        { label: 'Selecionar tudo', icon: Type, onSelect: () => window.dispatchEvent(new CustomEvent('atlas:context-select-all')) },
        { separator: true },
        { label: 'Excluir seleção', icon: Trash2, danger: true, onSelect: () => removeSelectedCanvasElements() },
      ]} />}
      {edgeContext && <ImageContextMenu position={edgeContext} ariaLabel="Opções da conexão" onClose={() => setEdgeContext(null)} actions={[
        { label: 'Excluir conexão', icon: Trash2, danger: true, onSelect: () => { setEdges(current => current.filter(edge => edge.id !== edgeContext.id)); setEdgeContext(null) } },
      ]} />}
      </div>
    </div>
    {detailNodeId && nodes.some(node => node.id === detailNodeId) && <LoreDetailsDrawer key={detailNodeId} node={nodes.find(node => node.id === detailNodeId)} onClose={() => setDetailNodeId(null)} onUpdate={(key, value) => nodeOps.updateNodeData(detailNodeId, key, value)} onOpenDocument={() => { const detailNode = nodes.find(node => node.id === detailNodeId); if (detailNode?.data?.documentId) nodeOps.openLinkedDocument(detailNode.data.documentId) }} />}
    <TableDialog open={tableOpen} onOpenChange={setTableOpen} onCreate={tableCreated} />
    <TableDialog open={cardTableOpen} onOpenChange={setCardTableOpen} onCreate={cardTableCreated} />
    <InsertDocumentDialog open={documentPickerOpen} onOpenChange={setDocumentPickerOpen} documents={documents} onChoose={doc => addNode('document', { data: { documentId: doc.id, title: doc.name || 'Documento', richContent: doc.content || '<p></p>' } })} />
  </section>
}

function applyDocumentImageTextFlow(editor) {
  const root = editor?.view?.dom
  if (!root) return
  const rootRect = root.getBoundingClientRect()
  const scaleX = root.clientWidth ? rootRect.width / root.clientWidth : 1
  const images = [...root.querySelectorAll('.doc-image-node[data-free-position="true"]')]
  const blocks = [...root.querySelectorAll('p,h1,h2,h3,blockquote,pre,ul,ol,table')].filter(block => !block.closest('.doc-image-node'))
  for (const block of blocks) {
    if (!block.hasAttribute('data-atlas-base-margin-left')) {
      block.setAttribute('data-atlas-base-margin-left', block.style.marginLeft || '')
      block.setAttribute('data-atlas-base-margin-right', block.style.marginRight || '')
    }
    block.style.marginLeft = block.getAttribute('data-atlas-base-margin-left') || ''
    block.style.marginRight = block.getAttribute('data-atlas-base-margin-right') || ''
  }
  const leftReserve = new Map(), rightReserve = new Map()
  for (const image of images) {
    const rect = image.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) continue
    const localLeft = Math.max(0, (rect.left - rootRect.left) / Math.max(scaleX, 0.01))
    const localRight = Math.min(root.clientWidth || rootRect.width, (rect.right - rootRect.left) / Math.max(scaleX, 0.01))
    const side = (localLeft + localRight) / 2 < (root.clientWidth || rootRect.width) / 2 ? 'left' : 'right'
    blocks.forEach(block => {
      const blockRect = block.getBoundingClientRect()
      if (blockRect.bottom <= rect.top - 6 || blockRect.top >= rect.bottom + 8) return
      const reserve = side === 'left' ? localRight + 12 : Math.max(0, (root.clientWidth || rootRect.width) - localLeft) + 12
      const map = side === 'left' ? leftReserve : rightReserve
      map.set(block, Math.max(map.get(block) || 0, reserve))
    })
  }
  for (const [block, amount] of leftReserve) block.style.marginLeft = `${amount}px`
  for (const [block, amount] of rightReserve) block.style.marginRight = `${amount}px`
}

const documentImageFlowFrames = new WeakMap()
function scheduleDocumentImageTextFlow(editor) {
  if (!editor?.view || editor.isDestroyed || documentImageFlowFrames.has(editor)) return
  const frame = requestAnimationFrame(() => {
    documentImageFlowFrames.delete(editor)
    if (!editor.isDestroyed) applyDocumentImageTextFlow(editor)
  })
  documentImageFlowFrames.set(editor, frame)
}

function DocumentImageNode({ node, updateAttributes, selected, deleteNode, editor, getPos }) {
  const wrapperRef = useRef(null)
  const gestureRef = useRef(null)
  const listenersRef = useRef(null)
  const [contextPosition, setContextPosition] = useState(null)
  const closeContextMenu = useCallback(() => setContextPosition(null), [])
  const freePosition = node.attrs.freePosition === true
  const positionX = Math.max(0, Number(node.attrs.positionX) || 0)
  const positionY = Math.max(0, Number(node.attrs.positionY) || 0)
  const align = node.attrs.align === 'right' ? 'right' : node.attrs.align === 'center' ? 'center' : 'left'
  const baseMargin = align === 'right' ? { top: 3, right: 0, bottom: 5, left: 8 } : align === 'center' ? { top: 5, right: 0, bottom: 5, left: 0 } : { top: 3, right: 8, bottom: 5, left: 0 }
  const imageOffsetLeft = Number(node.attrs.imageOffsetLeft) || 0
  const imageOffsetRight = Number(node.attrs.imageOffsetRight) || 0
  const imageOffsetTop = Number(node.attrs.imageOffsetTop) || 0
  const removeGestureListeners = () => {
    const listeners = listenersRef.current
    if (!listeners) return
    document.removeEventListener('pointermove', listeners.move, true)
    document.removeEventListener('pointerup', listeners.end, true)
    window.removeEventListener('pointerup', listeners.end, true)
    document.removeEventListener('pointercancel', listeners.cancel, true)
    window.removeEventListener('pointercancel', listeners.cancel, true)
    window.removeEventListener('blur', listeners.cancel, true)
    listenersRef.current = null
  }
  useEffect(() => () => removeGestureListeners(), [])
  useEffect(() => { scheduleDocumentImageTextFlow(editor) }, [editor, freePosition, positionX, positionY, node.attrs.width, node.attrs.height])

  const finishMove = (event, moved) => {
    const sourcePos = typeof getPos === 'function' ? getPos() : null
    const sourceNode = Number.isInteger(sourcePos) ? editor.state.doc.nodeAt(sourcePos) : null
    if (!sourceNode || !Number.isInteger(sourcePos) || !moved) return
    const blocks = []
    editor.state.doc.forEach((block, blockPos) => {
      if (blockPos === sourcePos) return
      const element = editor.view.nodeDOM(blockPos)
      const rect = element?.getBoundingClientRect?.()
      if (rect && rect.height > 0) blocks.push({ pos: blockPos, end: blockPos + block.nodeSize, midpoint: rect.top + rect.height / 2 })
    })
    const nextBlock = blocks.find(block => event.clientY < block.midpoint)
    const targetPos = nextBlock?.pos ?? blocks.at(-1)?.end ?? editor.state.doc.content.size
    if (targetPos === sourcePos || targetPos === sourcePos + sourceNode.nodeSize) return
    const rootRect = editor.view.dom.getBoundingClientRect()
    const nextAlign = event.clientX < rootRect.left + rootRect.width / 2 ? 'left' : 'right'
    let tr = editor.state.tr.delete(sourcePos, sourcePos + sourceNode.nodeSize)
    const mappedPos = Math.max(0, Math.min(tr.doc.content.size, tr.mapping.map(targetPos, targetPos < sourcePos ? -1 : 1)))
    const movedNode = sourceNode.type.create({
      ...sourceNode.attrs, align: nextAlign, layoutPreset: nextAlign, freePosition: false,
      positionX: null, positionY: null, imageOffsetLeft: 0, imageOffsetRight: 0, imageOffsetTop: 0,
    }, sourceNode.content, sourceNode.marks)
    tr = tr.insert(mappedPos, movedNode)
    editor.view.dispatch(tr.scrollIntoView())
    scheduleDocumentImageTextFlow(editor)
  }

  const beginResize = (event, edge) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const wrapper = wrapperRef.current, root = editor?.view?.dom
    if (!wrapper || !root) return
    const rect = wrapper.getBoundingClientRect(), rootRect = root.getBoundingClientRect()
    const scaleX = root.clientWidth ? rootRect.width / root.clientWidth : 1
    const scaleY = root.clientHeight ? rootRect.height / root.clientHeight : scaleX
    const originalStyle = wrapper.getAttribute('style') || ''
    const baseWidth = Math.max(40, Number(node.attrs.width) || rect.width / Math.max(scaleX, 0.01))
    const baseHeight = Math.max(40, Number(node.attrs.height) || rect.height / Math.max(scaleY, 0.01))
    const baseLeft = Number(node.attrs.imageOffsetLeft) || 0
    const baseRight = Number(node.attrs.imageOffsetRight) || 0
    const baseTop = Number(node.attrs.imageOffsetTop) || 0
    const computedMargin = getComputedStyle(wrapper)
    const resizeMargin = align === 'center' ? {
      left: (Number.parseFloat(computedMargin.marginLeft) || 0) / Math.max(scaleX, 0.01) - baseLeft,
      right: (Number.parseFloat(computedMargin.marginRight) || 0) / Math.max(scaleX, 0.01) - baseRight,
      top: 5,
    } : baseMargin
    const gesture = { pointerId: event.pointerId, edge, clientX: event.clientX, clientY: event.clientY, scaleX, scaleY, baseWidth, baseHeight, baseLeft, baseRight, baseTop, originalStyle }
    gestureRef.current = gesture
    const measure = e => {
      const dx = (e.clientX - gesture.clientX) / Math.max(0.05, scaleX)
      const dy = (e.clientY - gesture.clientY) / Math.max(0.05, scaleY)
      const next = {
        width: Math.round(Math.max(40, Math.min(root.clientWidth || rootRect.width, baseWidth + (edge === 'right' ? dx : edge === 'left' ? -dx : 0)))),
        height: Math.round(Math.max(40, Math.min(2400, baseHeight + (edge === 'bottom' ? dy : edge === 'top' ? -dy : 0)))),
        imageOffsetLeft: baseLeft,
        imageOffsetRight: baseRight,
        imageOffsetTop: baseTop,
        positionX,
        positionY,
        dx, dy,
      }
      if (freePosition) {
        if (edge === 'left') next.positionX += (dx / Math.max(0.05, scaleX)) / Math.max(1, root.clientWidth || rootRect.width) * 100
        if (edge === 'top') next.positionY += dy / Math.max(0.05, scaleY)
      } else {
        if (align === 'center' && edge === 'left') next.imageOffsetLeft += (baseWidth - next.width) / 2
        if (align === 'center' && edge === 'right') next.imageOffsetLeft += (next.width - baseWidth) / 2
        if (edge === 'left' && align === 'left') next.imageOffsetLeft += baseWidth - next.width
        if (edge === 'right' && align === 'right') next.imageOffsetRight -= next.width - baseWidth
        if (edge === 'top') next.imageOffsetTop += baseHeight - next.height
      }
      return next
    }
    const move = e => {
      const current = gestureRef.current
      if (!current || current.pointerId !== e.pointerId) return
      e.preventDefault(); e.stopPropagation()
      const next = measure(e), element = wrapperRef.current
      if (!element) return
      element.style.width = `${next.width}px`; element.style.height = `${next.height}px`
      if (freePosition) {
        element.style.left = `${next.positionX}%`; element.style.top = `${next.positionY}px`
      } else if (align === 'center') {
        element.style.marginLeft = `${((root.clientWidth || rootRect.width) - next.width) / 2 + next.imageOffsetLeft}px`
        element.style.marginRight = 'auto'
        element.style.marginTop = `${resizeMargin.top + next.imageOffsetTop}px`
      } else {
        element.style.marginLeft = `${baseMargin.left + next.imageOffsetLeft}px`
        element.style.marginRight = `${baseMargin.right + next.imageOffsetRight}px`
        element.style.marginTop = `${resizeMargin.top + next.imageOffsetTop}px`
      }
    }
    const end = e => {
      const current = gestureRef.current
      if (!current || current.pointerId !== e.pointerId) return
      const next = measure(e)
      gestureRef.current = null; removeGestureListeners()
      if (wrapperRef.current) wrapperRef.current.setAttribute('style', current.originalStyle)
      updateAttributes({ width: next.width, height: next.height, imageOffsetLeft: next.imageOffsetLeft, imageOffsetRight: next.imageOffsetRight, imageOffsetTop: next.imageOffsetTop, ...(freePosition ? { positionX: next.positionX, positionY: next.positionY } : {}) })
    }
    const cancel = e => {
      const current = gestureRef.current
      if (!current || (Number.isInteger(e.pointerId) && current.pointerId !== e.pointerId)) return
      gestureRef.current = null; removeGestureListeners()
      if (wrapperRef.current) wrapperRef.current.setAttribute('style', current.originalStyle)
    }
    listenersRef.current = { move, end, cancel }
    document.addEventListener('pointermove', move, { capture: true, passive: false })
    document.addEventListener('pointerup', end, { capture: true, passive: false })
    window.addEventListener('pointerup', end, { capture: true, passive: false })
    document.addEventListener('pointercancel', cancel, { capture: true, passive: false })
    window.addEventListener('pointercancel', cancel, { capture: true, passive: false })
    window.addEventListener('blur', cancel, true)
  }

  const startMove = event => {
    if (event.button !== 0 || event.target?.closest?.('.doc-image-toolbar, .doc-image-resize-grip')) return
    const wrapper = wrapperRef.current, root = editor?.view?.dom
    if (!wrapper || !root) return
    const rect = wrapper.getBoundingClientRect()
    try { if (typeof getPos === 'function') editor.commands.setNodeSelection(getPos()) } catch {}
    event.preventDefault(); event.stopPropagation()
    const rootRect = root.getBoundingClientRect()
    const scaleX = root.clientWidth ? rootRect.width / root.clientWidth : 1
    const scaleY = root.clientHeight ? rootRect.height / root.clientHeight : scaleX
    const originalStyle = wrapper.getAttribute('style') || ''
    const move = e => {
      const current = gestureRef.current
      if (!current || current.pointerId !== e.pointerId) return
      const dx = e.clientX - current.clientX, dy = e.clientY - current.clientY
      if (!current.moved && Math.hypot(dx, dy) < 3) return
      current.moved = true; e.preventDefault(); e.stopPropagation()
      const element = wrapperRef.current
      if (!element) return
      element.style.transform = `translate(${dx / current.scaleX}px, ${dy / current.scaleY}px)`
      element.style.zIndex = 'var(--z-image-preview)'
    }
    const finish = e => {
      const current = gestureRef.current
      if (!current || current.pointerId !== e.pointerId) return
      gestureRef.current = null; removeGestureListeners()
      const element = wrapperRef.current
      if (element) element.setAttribute('style', current.originalStyle)
      finishMove(e, current.moved)
    }
    const cancel = e => {
      const current = gestureRef.current
      if (!current || (Number.isInteger(e.pointerId) && current.pointerId !== e.pointerId)) return
      gestureRef.current = null; removeGestureListeners()
      if (wrapperRef.current) wrapperRef.current.setAttribute('style', current.originalStyle)
      scheduleDocumentImageTextFlow(editor)
    }
    gestureRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scaleX, scaleY, originalStyle, moved: false }
    try { wrapper.setPointerCapture?.(event.pointerId) } catch {}
    listenersRef.current = { move, end: finish, cancel }
    document.addEventListener('pointermove', move, { capture: true, passive: false })
    document.addEventListener('pointerup', finish, { capture: true, passive: false })
    window.addEventListener('pointerup', finish, { capture: true, passive: false })
    document.addEventListener('pointercancel', cancel, { capture: true, passive: false })
    window.addEventListener('pointercancel', cancel, { capture: true, passive: false })
    window.addEventListener('blur', cancel, true)
  }
  const fit = (objectFit, extra = {}) => updateAttributes({ objectFit, ...extra })
  const setPreset = (align, layoutPreset) => updateAttributes({ align, layoutPreset, freePosition: false, positionX: null, positionY: null, imageOffsetLeft: 0, imageOffsetRight: 0, imageOffsetTop: 0 })
  const handles = ['top', 'right', 'bottom', 'left']
  const imageWidth = node.attrs.width ? `${node.attrs.width}px` : 'auto'
  const centerBias = (Number(node.attrs.width) || 0) / 2 - imageOffsetLeft
  const centeredMarginLeft = align === 'center' && imageOffsetLeft ? `calc(50% ${centerBias < 0 ? '+' : '-'} ${Math.abs(centerBias)}px)` : 'auto'
  return <NodeViewWrapper as="div" ref={wrapperRef} className={`doc-image-node align-${align} preset-${node.attrs.layoutPreset || 'block'} ${selected ? 'selected' : ''}`} data-free-position={String(freePosition)} contentEditable={false} onPointerDown={startMove} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextPosition({ x: event.clientX, y: event.clientY }) }} style={{ ...(freePosition ? { position: 'absolute', float: 'none', margin: 0, left: `${positionX}%`, top: `${positionY}px`, zIndex: 'var(--z-image-preview)' } : {}), width: imageWidth, height: node.attrs.height ? `${node.attrs.height}px` : 'auto', marginTop: `${baseMargin.top + imageOffsetTop}px`, marginRight: align === 'center' ? 'auto' : `${baseMargin.right + imageOffsetRight}px`, marginBottom: `${baseMargin.bottom}px`, marginLeft: align === 'center' ? centeredMarginLeft : `${baseMargin.left + imageOffsetLeft}px`, maxWidth: '100%', resize: 'none', overflow: 'visible', touchAction: 'none' }}>
    <img src={node.attrs.src} alt={node.attrs.alt || ''} draggable="false" style={{ width: '100%', height: '100%', maxWidth: '100%', objectFit: node.attrs.objectFit === 'fill' ? 'fill' : node.attrs.objectFit === 'cover' ? 'cover' : node.attrs.objectFit === 'none' ? 'none' : 'contain' }} />
    {selected && handles.map(edge => <span key={edge} className={`doc-image-resize-grip edge-${edge}`} title={`Arraste para redimensionar (${edge})`} onPointerDown={event => beginResize(event, edge)} />)}
    {contextPosition && <ImageContextMenu position={contextPosition} onClose={closeContextMenu} actions={[
      { label: 'Copiar texto selecionado', icon: Copy, onSelect: async () => { const selection = editor?.state?.selection; if (selection && selection.to > selection.from) await navigator.clipboard?.writeText(editor.state.doc.textBetween(selection.from, selection.to, '\n')); else await navigator.clipboard?.writeText(node.attrs.src || '') } },
      { label: 'Colar texto', icon: ClipboardPaste, onSelect: async () => { const text = await navigator.clipboard?.readText(); if (editor && typeof text === 'string' && text.length) { const { from, to } = editor.state.selection; editor.chain().focus().insertContentAt({ from, to }, normalizeClipboardInlineText(text)).run() } } },
      { label: 'Selecionar tudo no documento', icon: Type, onSelect: () => editor?.chain().focus().selectAll().run() },
      { separator: true },
      { label: 'Quebra de texto à esquerda', icon: AlignLeft, onSelect: () => setPreset('left', 'left') },
      { label: 'Quebra de texto à direita', icon: AlignRight, onSelect: () => setPreset('right', 'right') },
      { label: 'Banner centralizado', icon: AlignCenter, onSelect: () => setPreset('center', 'banner') },
      { separator: true },
      { label: 'Conter', icon: Maximize2, onSelect: () => fit('contain') },
      { label: 'Preencher', icon: ImageIcon, onSelect: () => fit('cover') },
      { label: 'Esticar', icon: Maximize2, onSelect: () => fit('fill') },
      { label: 'Tamanho original', icon: FileImage, onSelect: () => fit('none', { width: node.attrs.naturalWidth || null, height: node.attrs.naturalHeight || null }) },
      { separator: true },
      { label: 'Excluir imagem', icon: Trash2, danger: true, onSelect: deleteNode },
    ]} />}
  </NodeViewWrapper>
}

const AtlasDocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: element => element.getAttribute('width') ? Number(element.getAttribute('width')) : null, renderHTML: attrs => attrs.width ? { width: attrs.width } : {} },
      height: { default: null, parseHTML: element => element.getAttribute('height') ? Number(element.getAttribute('height')) : null, renderHTML: attrs => attrs.height ? { height: attrs.height } : {} },
      objectFit: { default: 'contain', parseHTML: element => element.getAttribute('data-object-fit') || 'contain', renderHTML: attrs => ({ 'data-object-fit': attrs.objectFit || 'contain' }) },
      naturalWidth: { default: null, parseHTML: element => element.getAttribute('data-natural-width') ? Number(element.getAttribute('data-natural-width')) : null, renderHTML: attrs => attrs.naturalWidth ? { 'data-natural-width': attrs.naturalWidth } : {} },
      naturalHeight: { default: null, parseHTML: element => element.getAttribute('data-natural-height') ? Number(element.getAttribute('data-natural-height')) : null, renderHTML: attrs => attrs.naturalHeight ? { 'data-natural-height': attrs.naturalHeight } : {} },
      align: { default: 'left', parseHTML: element => element.getAttribute('data-atlas-align') || 'left', renderHTML: attrs => ({ 'data-atlas-align': attrs.align || 'left' }) },
      layoutPreset: { default: 'block', parseHTML: element => element.getAttribute('data-layout-preset') || 'block', renderHTML: attrs => ({ 'data-layout-preset': attrs.layoutPreset || 'block' }) },
      freePosition: { default: false, parseHTML: element => element.getAttribute('data-free-position') === 'true', renderHTML: attrs => ({ 'data-free-position': String(attrs.freePosition === true) }) },
      positionX: { default: null, parseHTML: element => element.hasAttribute('data-position-x') ? Number(element.getAttribute('data-position-x')) : null, renderHTML: attrs => attrs.positionX !== null && attrs.positionX !== undefined ? { 'data-position-x': String(attrs.positionX) } : {} },
      positionY: { default: null, parseHTML: element => element.hasAttribute('data-position-y') ? Number(element.getAttribute('data-position-y')) : null, renderHTML: attrs => attrs.positionY !== null && attrs.positionY !== undefined ? { 'data-position-y': String(attrs.positionY) } : {} },
      imageOffsetLeft: { default: 0, parseHTML: element => Number(element.getAttribute('data-image-offset-left')) || 0, renderHTML: attrs => attrs.imageOffsetLeft ? { 'data-image-offset-left': String(attrs.imageOffsetLeft) } : {} },
      imageOffsetRight: { default: 0, parseHTML: element => Number(element.getAttribute('data-image-offset-right')) || 0, renderHTML: attrs => attrs.imageOffsetRight ? { 'data-image-offset-right': String(attrs.imageOffsetRight) } : {} },
      imageOffsetTop: { default: 0, parseHTML: element => Number(element.getAttribute('data-image-offset-top')) || 0, renderHTML: attrs => attrs.imageOffsetTop ? { 'data-image-offset-top': String(attrs.imageOffsetTop) } : {} },
    }
  },
  addNodeView() { return ReactNodeViewRenderer(DocumentImageNode) },
}).configure({ allowBase64: true, inline: false })

function InsertMenu({ editor, onPickImage, onPickFile, onOpenTable, onPickDocument }) {
  if (!editor && !onPickDocument) return null
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="format-button insert-trigger" onMouseDown={event => event.preventDefault()}><Plus size={15} /><span>Inserir</span><ChevronDown size={12} /></button></DropdownMenu.Trigger><AtlasDropdownContent className="insert-menu" align="start" sideOffset={6}>
    {onPickImage && <DropdownMenu.Item className="menu-item" onMouseDown={event => event.preventDefault()} onSelect={onPickImage}><ImageIcon size={14} /> Imagem</DropdownMenu.Item>}
    {onOpenTable && <DropdownMenu.Item className="menu-item" onMouseDown={event => event.preventDefault()} onSelect={onOpenTable}><Table2 size={14} /> Tabela</DropdownMenu.Item>}
    {editor && <DropdownMenu.Item className="menu-item" onMouseDown={event => event.preventDefault()} onSelect={() => { const url = window.prompt('Endereço do link (URL):', 'https://'); if (url?.trim()) editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run() }}><Link2 size={14} /> Link</DropdownMenu.Item>}
    {editor && <DropdownMenu.Item className="menu-item" onMouseDown={event => event.preventDefault()} onSelect={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={14} /> Divider</DropdownMenu.Item>}
    {editor && <DropdownMenu.Item className="menu-item" onMouseDown={event => event.preventDefault()} onSelect={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare size={14} /> Checklist</DropdownMenu.Item>}
    {onPickDocument && <DropdownMenu.Item className="menu-item" onMouseDown={event => event.preventDefault()} onSelect={onPickDocument}><FilePlus2 size={14} /> Documento no canvas…</DropdownMenu.Item>}
    {onPickFile && <><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item" onMouseDown={event => event.preventDefault()} onSelect={onPickFile}><File size={14} /> Arquivo</DropdownMenu.Item></>}
  </AtlasDropdownContent></DropdownMenu.Root>
}

function TextFormattingControls({ editor, compact = false, tableCell = null, onTableCellColorChange }) {
  const disabled = !editor
  const savedSelectionRef = useRef(null)
  const rememberSelection = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const { from, to } = editor.state.selection
    savedSelectionRef.current = { from, to }
  }, [editor])
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const saveSelection = () => {
      if (editor.isDestroyed) return
      const { from, to } = editor.state.selection
      savedSelectionRef.current = { from, to }
    }
    editor.on('selectionUpdate', saveSelection)
    editor.on('focus', saveSelection)
    saveSelection()
    return () => {
      editor.off('selectionUpdate', saveSelection)
      editor.off('focus', saveSelection)
    }
  }, [editor])
  const run = callback => {
    if (!editor || editor.isDestroyed) return
    const saved = savedSelectionRef.current
    let chain = editor.chain().focus()
    if (saved && Number.isInteger(saved.from) && Number.isInteger(saved.to) && saved.from >= 0 && saved.to <= editor.state.doc.content.size) {
      chain = chain.setTextSelection({ from: saved.from, to: saved.to })
    }
    callback(chain)
  }
  const blockStyle = !editor ? 'paragraph'
    : editor.isActive('heading', { level: 1 }) ? 'h1'
      : editor.isActive('heading', { level: 2 }) ? 'h2'
        : editor.isActive('heading', { level: 3 }) ? 'h3'
          : editor.isActive('blockquote') ? 'blockquote' : 'paragraph'
  const attrs = editor?.getAttributes('textStyle') || {}
  const highlightColor = editor?.getAttributes('highlight')?.color || attrs.backgroundColor || '#fff09c'
  const alignment = editor?.getAttributes('paragraph').textAlign || editor?.getAttributes('heading').textAlign || 'left'
  const AlignmentIcon = alignment === 'center' ? AlignCenter : alignment === 'right' ? AlignRight : alignment === 'justify' ? AlignJustify : AlignLeft
  const lineHeightValue = editor?.getAttributes('paragraph').lineHeight || editor?.getAttributes('heading').lineHeight || ''
  const hex = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#252a27'
  const formatButton = (label, Icon, active, callback, shortcut, extra = {}) => <button key={label} type="button" className={`format-button ${active ? 'active' : ''}`} title={`${label}${shortcut ? ` · ${shortcut}` : ''}`} aria-label={label} disabled={disabled || extra.disabled} onPointerDown={event => { rememberSelection(); event.preventDefault() }} onMouseDown={event => { rememberSelection(); event.preventDefault() }} onClick={() => run(callback)}><Icon size={compact ? 14 : 15} strokeWidth={1.8} /></button>
  // Radix menu items must be allowed to receive their native pointer/click sequence.
  // The trigger already bookmarks the ProseMirror selection; run() restores it
  // after the menu item is chosen. Preventing pointerdown here swallowed some
  // alignment/list commands when the active editor was a table cell.
  const menuItem = (label, Icon, callback, active = false) => <DropdownMenu.Item key={label} className={`menu-item toolbar-menu-item ${active ? 'active' : ''}`} onSelect={() => run(callback)}><Icon size={14} strokeWidth={1.8} /><span>{label}</span></DropdownMenu.Item>
  const setBlockStyle = value => run(chain => {
    if (value === 'paragraph') chain.setParagraph().run()
    if (value === 'h1') chain.setHeading({ level: 1 }).run()
    if (value === 'h2') chain.setHeading({ level: 2 }).run()
    if (value === 'h3') chain.setHeading({ level: 3 }).run()
    if (value === 'blockquote') chain.setBlockquote().run()
  })
  return <div className={`text-format-controls ${compact ? 'compact' : ''}`} onMouseDownCapture={rememberSelection}>
    <div className="toolbar-group toolbar-history-group">
      {formatButton('Desfazer', Undo2, false, chain => chain.undo().run(), 'Ctrl+Z', { disabled: !editor?.can().undo() })}
      {formatButton('Refazer', Redo2, false, chain => chain.redo().run(), 'Ctrl+Shift+Z', { disabled: !editor?.can().redo() })}
    </div>
    <span className="toolbar-divider" />
    <AtlasSelect disabled={disabled} ariaLabel="Estilo do parágrafo" className="format-select-label paragraph-style-select" value={blockStyle} onChange={setBlockStyle} options={[{ value: 'paragraph', label: 'Texto normal' }, { value: 'h1', label: 'Título 1' }, { value: 'h2', label: 'Título 2' }, { value: 'h3', label: 'Título 3' }, { value: 'blockquote', label: 'Citação' }]} />
    <AtlasSelect disabled={disabled} ariaLabel="Fonte" className="format-select-label font-family-select" value={attrs.fontFamily || ''} onChange={value => run(chain => value ? chain.setFontFamily(value).run() : chain.unsetFontFamily().run())} options={[{ value: '', label: 'Fonte' }, ...['Arial','Aptos','Calibri','Inter','Segoe UI','Georgia','Garamond','Times New Roman','Verdana','Consolas','Courier New'].map(font => ({ value: font, label: font }))]} />
    <AtlasSelect disabled={disabled} ariaLabel="Tamanho da fonte" className="format-select-label format-size-select" value={attrs.fontSize || ''} onChange={value => run(chain => value ? chain.setFontSize(value).run() : chain.unsetFontSize().run())} options={[{ value: '', label: 'Tamanho' }, ...['8pt','9pt','10pt','11pt','12pt','14pt','16pt','18pt','24pt','36pt','48pt','72pt'].map(size => ({ value: size, label: size.replace('pt', '') }))]} />
    <div className="toolbar-group">
      {formatButton('Negrito', Bold, editor?.isActive('bold'), chain => chain.toggleBold().run(), 'Ctrl+B')}
      {formatButton('Itálico', Italic, editor?.isActive('italic'), chain => chain.toggleItalic().run(), 'Ctrl+I')}
      {formatButton('Sublinhado', UnderlineIcon, editor?.isActive('underline'), chain => chain.toggleUnderline().run(), 'Ctrl+U')}
      {formatButton('Tachado', Strikethrough, editor?.isActive('strike'), chain => chain.toggleStrike().run(), 'Alt+Shift+5')}
      {formatButton('Sobrescrito', SuperscriptIcon, editor?.isActive('superscript'), chain => chain.toggleSuperscript().run(), 'Ctrl+.')}
      {formatButton('Subscrito', SubscriptIcon, editor?.isActive('subscript'), chain => chain.toggleSubscript().run(), 'Ctrl+,')}
      {formatButton('Código em linha', Code2, editor?.isActive('code'), chain => chain.toggleCode().run(), '')}
    </div>
    <span className="toolbar-divider" />
    <AtlasColorPicker disabled={!editor && !tableCell} kind="text" label={editor ? 'Cor do texto' : 'Cor do texto da célula'} value={hex(editor ? attrs.color : tableCell?.color)} onCommit={color => { if (editor) run(chain => chain.setColor(color).run()); else if (tableCell) onTableCellColorChange?.(color) }} />
    <AtlasColorPicker disabled={disabled} kind="highlight" label="Cor de destaque" value={hex(highlightColor)} onCommit={color => run(chain => chain.unsetBackgroundColor().setHighlight({ color }).run())} />
    <span className="toolbar-divider" />
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button type="button" className="format-button toolbar-dropdown-trigger" title="Alinhamento do parágrafo" aria-label="Alinhamento do parágrafo" disabled={disabled} onPointerDown={() => rememberSelection()} onMouseDown={() => rememberSelection()}><AlignmentIcon size={14} /><ChevronDown size={10} /></button></DropdownMenu.Trigger>
      <AtlasDropdownContent className="menu-content toolbar-command-menu" align="start" sideOffset={4}>
        {menuItem('Alinhar à esquerda', AlignLeft, chain => chain.setTextAlign('left').run(), alignment === 'left')}
        {menuItem('Centralizar', AlignCenter, chain => chain.setTextAlign('center').run(), alignment === 'center')}
        {menuItem('Alinhar à direita', AlignRight, chain => chain.setTextAlign('right').run(), alignment === 'right')}
        {menuItem('Justificar', AlignJustify, chain => chain.setTextAlign('justify').run(), alignment === 'justify')}
      </AtlasDropdownContent>
    </DropdownMenu.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button type="button" className="format-button toolbar-dropdown-trigger" title="Listas e parágrafos" aria-label="Listas e parágrafos" disabled={disabled} onPointerDown={() => rememberSelection()} onMouseDown={() => rememberSelection()}><List size={14} /><ChevronDown size={10} /></button></DropdownMenu.Trigger>
      <AtlasDropdownContent className="menu-content toolbar-command-menu" align="start" sideOffset={4}>
        {menuItem('Lista com marcadores', List, chain => chain.toggleBulletList().run(), editor?.isActive('bulletList'))}
        {menuItem('Lista numerada', ListOrdered, chain => chain.toggleOrderedList().run(), editor?.isActive('orderedList'))}
        {menuItem('Checklist', CheckSquare, chain => chain.toggleTaskList().run(), editor?.isActive('taskList'))}
        <DropdownMenu.Separator className="menu-separator" />
        {menuItem('Diminuir recuo', IndentDecrease, chain => chain.decreaseParagraphIndent().run())}
        {menuItem('Aumentar recuo', IndentIncrease, chain => chain.increaseParagraphIndent().run())}
      </AtlasDropdownContent>
    </DropdownMenu.Root>
    <AtlasSelect disabled={disabled} ariaLabel="Espaçamento entre linhas" className="format-select-label line-height-select" value={lineHeightValue} onChange={value => run(chain => value ? chain.setLineHeight(value).run() : chain.unsetLineHeight().run())} options={[{ value: '', label: 'Espaçamento' }, { value: '1', label: '1,0' }, { value: '1.15', label: '1,15' }, { value: '1.5', label: '1,5' }, { value: '1.75', label: '1,75' }, { value: '2', label: '2,0' }]} />
    {formatButton('Citação', Quote, editor?.isActive('blockquote'), chain => editor?.isActive('blockquote') ? chain.setParagraph().run() : chain.setBlockquote().run(), '')}
    {formatButton('Limpar formatação', Type, false, chain => chain.unsetAllMarks().clearNodes().run(), '')}
  </div>
}

function EditorToolbar({ editor, item, onPageSizeChange, onMarginChange, onZoomChange, onPickImage, onPickFile, onOpenTable }) {
  if (!editor) return null
  return <div className="document-toolbar" aria-label="Ferramentas de documento">
    <TextFormattingControls editor={editor} />
    <span className="toolbar-divider" />
    <div className="document-toolbar-spacer" />
    <InsertMenu editor={editor} onPickImage={onPickImage} onPickFile={onPickFile} onOpenTable={onOpenTable} />
    <div className="page-control"><span>Página</span><AtlasSelect ariaLabel="Tamanho da página" className="page-control-select" value={item.pageSize || 'A4'} onChange={onPageSizeChange} options={[{ value: 'A4', label: 'A4' }, { value: 'A5', label: 'A5' }, { value: 'Letter', label: 'Carta' }]} /></div>
    <div className="page-control"><span>Margens</span><AtlasSelect ariaLabel="Margens do documento" className="page-control-select" value={item.margins ?? 15} onChange={value => onMarginChange(Number(value))} options={[{ value: 10, label: '10 mm' }, { value: 15, label: '15 mm' }, { value: 20, label: '20 mm' }, { value: 25, label: '25 mm' }]} /></div>
    <div className="page-control zoom-control"><ZoomIn size={13} /><AtlasSelect ariaLabel="Zoom do documento" className="page-control-select" value={item.zoom || 100} onChange={value => onZoomChange(Number(value))} options={[{ value: 75, label: '75%' }, { value: 90, label: '90%' }, { value: 100, label: '100%' }, { value: 110, label: '110%' }, { value: 125, label: '125%' }, { value: 150, label: '150%' }]} /></div>
  </div>
}

function DocumentEditor({ item, onContentChange, onNameChange, onPageSizeChange, onMarginChange, onZoomChange, onStoreImage, onOpenTableDialog, onNotice }) {
  const imageInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const [tableOpen, setTableOpen] = useState(false)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false, codeBlock: false }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Underline, ...SharedTextExtensions,
      Placeholder.configure({ placeholder: 'Comece a escrever…' }),
      TaskList, TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'doc-table' } }), TableRow, TableHeader, TableCell,
      AtlasDocumentImage,
    ],
    content: item.content || '<p></p>',
    editorProps: { attributes: { class: 'tiptap-editor', 'aria-label': 'Conteúdo do documento' }, transformCopied: slice => stripImagesFromCopiedSlice(slice), handlePaste: handleInlineTextPaste },
    onUpdate: ({ editor: currentEditor }) => { onContentChange(currentEditor.getHTML()); scheduleDocumentImageTextFlow(currentEditor) },
  }, [item.id])

  const insertImage = async file => {
    if (!file || !editor) return
    if (!file.type.startsWith('image/')) { onNotice?.('Escolha uma imagem.'); return }
    const src = await readImageForAtlas(file)
    const dimensions = await new Promise(resolve => { const probe = new window.Image(); probe.onload = () => resolve({ width: probe.naturalWidth || 640, height: probe.naturalHeight || 420 }); probe.onerror = () => resolve({ width: 640, height: 420 }); probe.src = src })
    const initialWidth = Math.min(620, dimensions.width)
    const initialHeight = Math.round(initialWidth * dimensions.height / Math.max(1, dimensions.width))
    editor.chain().focus().setImage({ src, alt: file.name, width: initialWidth, height: initialHeight, naturalWidth: dimensions.width, naturalHeight: dimensions.height, objectFit: 'contain' }).run()
    onStoreImage(file.name, src)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }
  const insertFile = async file => {
    if (!file || !editor) return
    if (file.size > 600_000) { onNotice?.('Para manter o backup leve, anexe arquivos de até 600 KB nesta Alpha.'); return }
    const src = await readFileAsDataURL(file)
    const safeName = file.name.replace(/[&<>"']/g, '')
    editor.chain().focus().insertContent(`<p><a href="${src}" download="${safeName}" target="_blank" rel="noopener noreferrer">ðŸ“Ž ${safeName}</a></p>`).run()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  const applyTable = (rows, cols) => editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
  return <section className="document-workspace">
    <div className="document-filebar"><div className="document-crumb"><span className="doc-file-symbol"><FileText size={15} /></span><EditableName name={item.name} onSave={onNameChange} className="document-editable-title" inputClassName="document-title-input" title="Renomear documento" /><span className="saved-inline"><Check size={12} /> Salvo localmente</span></div><span className="document-private-label">Somente neste dispositivo</span></div>
    <EditorToolbar editor={editor} item={item} onPageSizeChange={onPageSizeChange} onMarginChange={onMarginChange} onZoomChange={onZoomChange} onPickImage={() => imageInputRef.current?.click()} onPickFile={() => fileInputRef.current?.click()} onOpenTable={() => setTableOpen(true)} />
    <input ref={imageInputRef} hidden type="file" accept="image/*" onChange={e => insertImage(e.target.files?.[0])} /><input ref={fileInputRef} hidden type="file" onChange={e => insertFile(e.target.files?.[0])} />
    <div className={`document-scroll page-${(item.pageSize || 'A4').toLowerCase()}`}>
      <article className={`paper page-${(item.pageSize || 'A4').toLowerCase()}`} style={{ '--doc-zoom': (item.zoom || 100) / 100, '--doc-margin': `${item.margins ?? 15}mm` }}><EditorContent editor={editor} /></article>
    </div>
    <div className="document-statusbar"><span><AlignLeft size={12} /> Documento</span><span>{item.pageSize || 'A4'} · {item.zoom || 100}% · Salvo automaticamente</span></div>
    <TableDialog open={tableOpen} onOpenChange={setTableOpen} onCreate={applyTable} />
  </section>
}

function ImageFileView({ item, onBack }) {
  return <section className="image-file-view"><div className="image-file-bar"><button className="back-button" onClick={onBack} title="Voltar"><ArrowLeft size={15} /></button><FileImage size={16} /><strong>{item.name}</strong></div><div className="image-file-preview"><img src={item.imageData} alt={item.name} /></div><div className="image-file-caption">Imagem armazenada localmente no Atlas.</div></section>
}

function HomeView({ items, search, onSearch, onCreate, onOpen, onRename, onDelete, onDuplicate, onMove }) {
  const filtered = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
  const recent = [...filtered].filter(item => item.type !== 'folder').sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)).slice(0, 8)
  const folders = filtered.filter(item => item.type === 'folder')
  const renderRows = list => list.map(item => <div className="file-table-row" data-item-id={item.id} key={item.id}>
    <button className="file-table-name" onClick={() => onOpen(item.id)}><span className={`table-file-icon ${item.type}`}><FileIcon type={item.type} size={15} /></span><span><strong>{item.name}</strong><small>{item.type === 'canvas' ? `${(item.nodes || []).length} objetos no canvas` : item.type === 'doc' ? 'Documento de texto' : item.type === 'image' ? 'Imagem' : 'Pasta do Atlas'}</small></span></button>
    <span className="file-table-type">{fileKind(item.type)}</span><span className="file-table-date"><Clock3 size={12} />{dateLabel(item.updatedAt || item.createdAt)}</span>
    <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button file-row-menu" aria-label={`Opções de ${item.name}`}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger><AtlasDropdownContent className="menu-content" align="end" sideOffset={4}><DropdownMenu.Item className="menu-item" onSelect={() => onRename(item)}><Settings2 size={14} /> Renomear</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => onDuplicate(item)}><Copy size={14} /> Duplicar</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => onMove(item)}><MoveRight size={14} /> Mover para pasta…</DropdownMenu.Item><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item danger" onSelect={() => onDelete(item)}><Trash2 size={14} /> Excluir</DropdownMenu.Item></AtlasDropdownContent></DropdownMenu.Root>
  </div>)
  return <div className="home-scroll"><div className="home-content">
    <div className="welcome-row"><div><div className="eyebrow">ATLAS · 1.5 ALPHA</div><h1>Um espaço para pensar<br /><span>com clareza.</span></h1><p>Organize ideias em canvas, escreva documentos e conecte o que importa.</p></div></div>
    <section className="create-section"><div className="section-heading"><h2>Comece por aqui</h2><span>Crie um espaço novo</span></div><div className="create-grid">
      <button className="create-card create-canvas" onClick={() => onCreate('canvas')}><span className="create-icon"><Network size={18} /></span><span className="create-card-copy"><strong>Canvas</strong><small>Mapeie ideias e conecte objetos</small></span><span className="create-arrow"><ArrowRight size={15} /></span></button>
      <button className="create-card create-document" onClick={() => onCreate('doc')}><span className="create-icon"><FileText size={18} /></span><span className="create-card-copy"><strong>Documento</strong><small>Escreva e organize seus textos</small></span><span className="create-arrow"><ArrowRight size={15} /></span></button>
      <button className="create-card create-folder" onClick={() => onCreate('folder')}><span className="create-icon"><FolderPlus size={18} /></span><span className="create-card-copy"><strong>Pasta</strong><small>Agrupe arquivos relacionados</small></span><span className="create-arrow"><ArrowRight size={15} /></span></button>
    </div></section>
    <section className="recent-section"><div className="section-heading recent-heading"><div><h2>Seus arquivos</h2><span>{items.length ? `${items.length} itens no espaço de trabalho` : 'Seus projetos começam aqui'}</span></div><div className="recent-search"><Search size={14} /><input value={search} onChange={e => onSearch(e.target.value)} placeholder="Buscar arquivos" aria-label="Buscar arquivos" /></div></div>
      {items.length === 0 ? <div className="home-empty"><strong>Nenhum arquivo por enquanto</strong><p>Crie um canvas para explorar ideias ou um documento para começar a escrever.</p><button className="text-action" onClick={() => onCreate('canvas')}>Criar meu primeiro canvas <ArrowRight size={13} /></button></div> : recent.length || folders.length ? <div className="file-table"><div className="file-table-head"><span>Nome</span><span>Tipo</span><span>Última alteração</span><span /></div>{renderRows([...recent, ...folders].slice(0, 12))}</div> : <div className="search-empty">Nenhum arquivo corresponde a “{search}”.</div>}
    </section><footer className="home-footer"><span>Atlas · 1.7.5 Alpha</span><span>Seus mapas ficam neste dispositivo</span></footer>
  </div></div>
}

function FolderView({ folder, items, search, onSearch, onCreate, onOpen, onRename, onDelete, onDuplicate, onMove, onBack }) {
  const visible = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
  return <div className="home-scroll"><div className="home-content folder-content">
    <div className="folder-crumb"><button className="back-button" onClick={onBack} title="Voltar ao início"><ArrowLeft size={15} /></button><span>Início</span><ChevronRight size={13} /><Folder size={14} /><span>{folder.name}</span></div>
    <div className="folder-page-heading"><div><span className="eyebrow">PASTA</span><h1>{folder.name}</h1><p>Um espaço para reunir arquivos relacionados.</p></div><ActionButton icon={Plus} variant="primary" onClick={() => onCreate('doc')}>Novo arquivo</ActionButton></div>
    <section className="create-section folder-create-section"><div className="section-heading"><h2>Criar nesta pasta</h2><span>Os novos arquivos ficam aqui</span></div><div className="create-grid"><button className="create-card create-canvas" onClick={() => onCreate('canvas')}><span className="create-icon"><Network size={18} /></span><span className="create-card-copy"><strong>Canvas</strong><small>Mapeie ideias</small></span><span className="create-arrow"><ArrowRight size={15} /></span></button><button className="create-card create-document" onClick={() => onCreate('doc')}><span className="create-icon"><FileText size={18} /></span><span className="create-card-copy"><strong>Documento</strong><small>Desenvolva textos</small></span><span className="create-arrow"><ArrowRight size={15} /></span></button><button className="create-card create-folder" onClick={() => onCreate('folder')}><span className="create-icon"><FolderPlus size={18} /></span><span className="create-card-copy"><strong>Subpasta</strong><small>Organize por assunto</small></span><span className="create-arrow"><ArrowRight size={15} /></span></button></div></section>
    <section className="recent-section"><div className="section-heading recent-heading"><div><h2>Conteúdo da pasta</h2><span>{items.length ? `${items.length} itens` : 'Ainda não há arquivos'}</span></div><div className="recent-search"><Search size={14} /><input value={search} onChange={e => onSearch(e.target.value)} placeholder="Buscar nesta pasta" aria-label="Buscar nesta pasta" /></div></div>
      {visible.length ? <div className="file-table"><div className="file-table-head"><span>Nome</span><span>Tipo</span><span>Última alteração</span><span /></div>{visible.map(item => <div className="file-table-row" data-item-id={item.id} key={item.id}><button className="file-table-name" onClick={() => onOpen(item.id)}><span className={`table-file-icon ${item.type}`}><FileIcon type={item.type} size={15} /></span><span><strong>{item.name}</strong><small>{fileKind(item.type)}</small></span></button><span className="file-table-type">{fileKind(item.type)}</span><span className="file-table-date"><Clock3 size={12} />{dateLabel(item.updatedAt || item.createdAt)}</span><DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button file-row-menu" aria-label={`Opções de ${item.name}`}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger><AtlasDropdownContent className="menu-content" align="end" sideOffset={4}><DropdownMenu.Item className="menu-item" onSelect={() => onRename(item)}><Settings2 size={14} /> Renomear</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => onDuplicate(item)}><Copy size={14} /> Duplicar</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => onMove(item)}><MoveRight size={14} /> Mover para pasta…</DropdownMenu.Item><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item danger" onSelect={() => onDelete(item)}><Trash2 size={14} /> Excluir</DropdownMenu.Item></AtlasDropdownContent></DropdownMenu.Root></div>)}</div> : <div className="home-empty"><strong>{search ? 'Nada encontrado nesta pasta' : 'Esta pasta está vazia'}</strong><p>{search ? 'Tente outro termo.' : 'Crie um documento ou canvas para começar.'}</p></div>}
    </section>
  </div></div>
}

function HelpDialog({ open, onOpenChange }) {
  const shortcutRows = [
    ['Buscar arquivos', 'Ctrl + K'], ['Salvar agora', 'Ctrl + S'], ['Desfazer', 'Ctrl + Z'],
    ['Refazer', 'Ctrl + Shift + Z'], ['Duplicar seleção', 'Ctrl + D'], ['Excluir objeto selecionado', 'Delete'],
    ['Zoom do mapa', 'Ctrl + rodinha'], ['Limpar seleção / fechar menu', 'Esc'],
  ]
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content atlas-help-dialog">
        <div className="dialog-heading">
          <div><Dialog.Title className="dialog-title">Ajuda e atalhos</Dialog.Title><Dialog.Description className="dialog-description">Como navegar e organizar ideias no Atlas.</Dialog.Description></div>
          <Dialog.Close asChild><button type="button" className="icon-button" aria-label="Fechar ajuda"><X size={16} /></button></Dialog.Close>
        </div>
        <div className="atlas-help-body">
          <section className="atlas-help-section"><div className="atlas-help-icon"><Network size={17} /></div><div><h3>Mapa mental</h3><p>Use <strong>Cartão</strong> para criar um nó de texto. Arraste os pontos das bordas de um cartão até outro para conectar ideias. Arraste o quadro com o botão do meio ou direito do mouse; selecione vários objetos arrastando uma área vazia.</p></div></section>
          <section className="atlas-help-section"><div className="atlas-help-icon"><ImageIcon size={17} /></div><div><h3>Imagens</h3><p>Insira uma imagem pela barra superior e arraste diretamente sobre ela para movê-la. Use as bordas e os cantos para redimensionar. Clique com o botão direito na imagem para abrir as ações, incluindo <strong>Excluir imagem</strong>, ajustar o preenchimento e voltar ao tamanho original.</p><p className="atlas-help-note">A imagem fica recortada dentro do seu quadro visual; não deve invadir a área ao redor.</p></div></section>
          <section className="atlas-help-section"><div className="atlas-help-icon"><Type size={17} /></div><div><h3>Texto e formatação</h3><p>Clique no texto de um cartão para editar. A barra de formatação permite títulos, negrito, itálico, sublinhado, listas, alinhamento, cores, links e tabelas. As ferramentas de formatação ficam inativas até um texto ou célula estar selecionado.</p></div></section>
          <section className="atlas-help-section"><div className="atlas-help-icon"><Search size={17} /></div><div><h3>Atalhos de teclado</h3><div className="atlas-help-shortcuts">{shortcutRows.map(([label, shortcut]) => <div className="atlas-help-shortcut" key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>)}</div></div></section>
        </div>
        <div className="dialog-footer"><button type="button" className="action-button primary" onClick={() => onOpenChange(false)}>Entendi</button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

export default function App() {
  const [items, setItems] = useState([])
  const [storageReady, setStorageReady] = useState(false)
  const changedItemsRef = useRef(new Map())
  const deletedItemsRef = useRef(new Map())
  const changeSequenceRef = useRef(0)
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createType, setCreateType] = useState('canvas')
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark')
  const [saveStatus, setSaveStatus] = useState('Tudo salvo')
  const [toast, setToast] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const [globalContextMenu, setGlobalContextMenu] = useState(null)
  const contextTargetRef = useRef(null)
  const [movingItem, setMovingItem] = useState(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const searchRef = useRef(null)
  const importRef = useRef(null)
  const imageLibraryInputRef = useRef(null)
  const toastTimer = useRef(null)
  const activeItem = items.find(item => item.id === activeId) || null
  const folders = items.filter(item => item.type === 'folder')
  const noteItemChange = useCallback(id => {
    changedItemsRef.current.set(id, ++changeSequenceRef.current)
    deletedItemsRef.current.delete(id)
  }, [])
  const noteItemDelete = useCallback(id => {
    changedItemsRef.current.delete(id)
    deletedItemsRef.current.set(id, ++changeSequenceRef.current)
  }, [])
  const showToast = useCallback(message => {
    setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])
  useEffect(() => {
    let mounted = true
    window.atlas.workspace.load().then(result => {
      if (!mounted) return
      const loaded = Array.isArray(result?.items) ? result.items : []
      // Preserve existing files, but open the latest map first. A fresh workspace
      // starts directly in a small editable mind map instead of a generic landing page.
      const existingCanvases = loaded.filter(entry => entry.type === 'canvas')
      if (loaded.length && existingCanvases.length) {
        setItems(loaded)
        const firstCanvas = [...existingCanvases]
          .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0]
        setActiveId(firstCanvas.id)
      } else {
        // Keep existing files intact, but ensure every workspace begins in the map-first flow.
        const starter = createStarterMindMap()
        noteItemChange(starter.id)
        setItems([...loaded, starter])
        setActiveId(starter.id)
      }
      setStorageReady(true)
    }).catch(error => {
      console.error('Atlas: não foi possível carregar os arquivos locais', error)
      if (mounted) setSaveStatus('Falha ao carregar')
    })
    return () => { mounted = false }
  }, [noteItemChange])
  const saveItems = useCallback(async currentItems => {
    const currentById = new Map(currentItems.map(item => [item.id, item]))
    const changedSnapshot = new Map(changedItemsRef.current)
    const deletedSnapshot = new Map(deletedItemsRef.current)
    const upserts = [...changedSnapshot.keys()].map(id => currentById.get(id)).filter(Boolean)
    const deletedIds = [...deletedSnapshot.keys()]
    if (!upserts.length && !deletedIds.length) { setSaveStatus('Tudo salvo'); return }
    setSaveStatus('Salvando…')
    try {
      await window.atlas.workspace.save({ upserts, deletedIds })
      changedSnapshot.forEach((revision, id) => { if (changedItemsRef.current.get(id) === revision) changedItemsRef.current.delete(id) })
      deletedSnapshot.forEach((revision, id) => { if (deletedItemsRef.current.get(id) === revision) deletedItemsRef.current.delete(id) })
      localStorage.removeItem(STORAGE_KEY)
      setSaveStatus('Tudo salvo')
    } catch (error) {
      console.error('Atlas: falha ao salvar arquivos locais', error)
      setSaveStatus('Falha ao salvar')
      throw error
    }
  }, [])
  useEffect(() => window.atlas.onFlushRequest(() => {
    if (!storageReady) { window.atlas.workspace.closeReady(false); return }
    saveItems(items).then(() => window.atlas.workspace.closeReady(true)).catch(() => window.atlas.workspace.closeReady(false))
  }), [items, storageReady, saveItems])
  const updateItem = useCallback((id, patch) => { noteItemChange(id); setItems(current => current.map(item => item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item)) }, [noteItemChange])
  const canvasDocuments = useMemo(() => items.filter(entry => entry.type === 'doc'), [items])
  const onDocumentContentChange = useCallback((documentId, content) => updateItem(documentId, { content }), [updateItem])
  const onDocumentNameChange = useCallback((documentId, name) => updateItem(documentId, { name }), [updateItem])
  const onOpenLinkedDocument = useCallback(documentId => { setActiveId(documentId); setSearch('') }, [])
  const storeImage = useCallback((name, imageData) => {
    const id = makeId(); noteItemChange(id)
    setItems(current => [{ id, type: 'image', name: name.replace(/\.[^.]+$/, '') || 'Imagem', imageData, createdAt: nowIso(), updatedAt: nowIso(), parentId: activeItem?.type === 'folder' ? activeItem.id : null }, ...current])
  }, [activeItem?.id, activeItem?.type, noteItemChange])
  useEffect(() => {
    if (!storageReady) return undefined
    setSaveStatus('Salvando…')
    const timer = setTimeout(() => {
      saveItems(items).catch(() => {})
      localStorage.setItem(THEME_KEY, theme)
    }, 250)
    return () => clearTimeout(timer)
  }, [items, theme, storageReady, saveItems])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => {
    const handler = event => {
      const target = event.target
      const editingText = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !editingText) { event.preventDefault(); searchRef.current?.focus() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveItems(items).then(() => showToast('Alterações salvas no dispositivo')).catch(() => showToast('Não foi possível salvar')) }
      if (event.key === 'Escape') setSearch('')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [items, showToast, saveItems])
  const createItem = useCallback((type, name) => {
    const now = nowIso()
    const newItem = { id: makeId(), type, name, createdAt: now, updatedAt: now, ...(activeItem?.type === 'folder' ? { parentId: activeItem.id } : {}), ...(type === 'doc' ? { content: '<p></p>', pageSize: 'A4', margins: 15, zoom: 100 } : {}), ...(type === 'canvas' ? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } : {}) }
    noteItemChange(newItem.id); setItems(current => [newItem, ...current]); setActiveId(newItem.id); setSearch(''); showToast(`${fileKind(type)} criado`)
  }, [activeItem?.id, activeItem?.type, noteItemChange, showToast])
  useEffect(() => {
    const remove = window.atlas.onMenuAction(action => {
      if (action === 'new-map') createItem('canvas', 'Novo mapa mental')
      if (action === 'about') showToast('Atlas 1.7.5 Alpha · conexões e controles de imagem')
    })
    const unsubscribeFailure = window.atlas.onFlushFailure?.(() => showToast('Não foi possível salvar; o Atlas permaneceu aberto.'))
    return () => { remove?.(); unsubscribeFailure?.() }
  }, [createItem, showToast])
  const openCreate = type => { setCreateType(type); setCreateOpen(true) }
  const onCanvasChange = useCallback(patch => { if (activeId) updateItem(activeId, patch) }, [activeId, updateItem])
  const renameItem = item => { const next = window.prompt('Novo nome:', item.name); if (next?.trim()) { updateItem(item.id, { name: next.trim() }); showToast('Nome atualizado') } }
  const deleteItem = item => {
    const descendants = new Set([item.id]); let found = true
    while (found) { found = false; items.forEach(entry => { if (entry.parentId && descendants.has(entry.parentId) && !descendants.has(entry.id)) { descendants.add(entry.id); found = true } }) }
    setPendingConfirm({
      title: item.type === 'doc' ? 'Excluir documento' : item.type === 'folder' ? 'Excluir pasta' : item.type === 'canvas' ? 'Excluir canvas' : 'Excluir imagem',
      description: `Excluir “${item.name}”${descendants.size > 1 ? ` e ${descendants.size - 1} item(ns) dentro dela` : ''}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir', destructive: true,
      onConfirm: () => {
        descendants.forEach(id => noteItemDelete(id))
        setItems(current => current.filter(entry => !descendants.has(entry.id)))
        if (descendants.has(activeId)) setActiveId(item.parentId && !descendants.has(item.parentId) ? item.parentId : null)
        showToast('Arquivo excluído')
      },
    })
  }
  const duplicateItem = item => {
    const descendants = [item]; let cursor = 0
    while (cursor < descendants.length) { const parent = descendants[cursor++]; items.filter(entry => entry.parentId === parent.id).forEach(child => descendants.push(child)) }
    const ids = new Map(descendants.map(entry => [entry.id, makeId()]))
    const copies = descendants.map(entry => ({ ...JSON.parse(JSON.stringify(entry)), id: ids.get(entry.id), name: entry.id === item.id ? `${entry.name} (cópia)` : entry.name, parentId: entry.parentId ? (ids.get(entry.parentId) || entry.parentId) : null, createdAt: nowIso(), updatedAt: nowIso() }))
    copies.forEach(copy => noteItemChange(copy.id))
    setItems(current => [...copies, ...current]); showToast('Cópia criada')
  }
  const isDescendant = (parentId, candidateId) => {
    let current = items.find(entry => entry.id === candidateId)
    while (current?.parentId) { if (current.parentId === parentId) return true; current = items.find(entry => entry.id === current.parentId) }
    return false
  }
  const moveItem = (item, destination) => {
    if (!item) return
    if (item.type === 'folder' && destination && (destination === item.id || isDescendant(item.id, destination))) { showToast('Não é possível mover uma pasta para dentro dela mesma.'); return }
    updateItem(item.id, { parentId: destination || undefined }); showToast(destination ? 'Arquivo movido para a pasta' : 'Arquivo movido para o espaço de trabalho')
  }
  const openMoveDialog = item => { setMovingItem(item); setMoveOpen(true) }
  const exportBackup = () => {
    const payload = { format: 'atlas-alpha-backup', version: 2, exportedAt: nowIso(), items }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `atlas-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); showToast('Backup exportado')
  }
  const importBackup = async event => {
    const file = event.target.files?.[0]; if (!file) return
    try { const parsed = JSON.parse(await file.text()); const incoming = Array.isArray(parsed) ? parsed : parsed.items
      if (!Array.isArray(incoming) || incoming.some(item => !item.id || !['canvas', 'doc', 'folder', 'image'].includes(item.type))) throw new Error('Formato inválido')
      setPendingConfirm({ title: 'Importar backup', description: `Importar ${incoming.length} itens? Os arquivos serão adicionados aos atuais.`, confirmLabel: 'Importar', onConfirm: () => { incoming.forEach(entry => noteItemChange(entry.id)); setItems(current => [...incoming, ...current]); showToast('Backup importado') } })
    } catch { showToast('Arquivo de backup inválido') }
    event.target.value = ''
  }
  const addImageFromLibrary = async event => {
    const file = event.target.files?.[0]; if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Escolha um arquivo de imagem.'); return }
    try { const imageData = await readImageForAtlas(file); storeImage(file.name, imageData); showToast('Imagem adicionada aos arquivos') }
    catch { showToast('Não foi possível importar a imagem') }
    event.target.value = ''
  }
  const renderFile = item => <SidebarFile key={item.id} item={item} active={activeId === item.id} onOpen={id => { setActiveId(id); setSearch('') }} onRename={renameItem} onDelete={deleteItem} onDuplicate={duplicateItem} onMove={openMoveDialog} onDropToFolder={(id, destination) => moveItem(items.find(entry => entry.id === id), destination)} />
  const visibleRootItems = items.filter(item => !item.parentId)
  const recentDocuments = visibleRootItems.filter(item => item.type === 'doc')
  const recentCanvases = visibleRootItems.filter(item => item.type === 'canvas')
  const rootFolders = visibleRootItems.filter(item => item.type === 'folder')
  const rootImages = visibleRootItems.filter(item => item.type === 'image')

  const handleGlobalContextMenu = event => {
    if (event.target?.closest?.('.image-context-menu, .menu-content, [role="dialog"]')) return
    event.preventDefault()
    const element = event.target instanceof Element ? event.target : null
    const fileElement = element?.closest?.('.sidebar-file[data-item-id], .file-table-row[data-item-id]')
    const fileId = fileElement?.getAttribute('data-item-id') || null
    contextTargetRef.current = { element, fileId, selectedText: String(window.getSelection?.() || '') }
    setGlobalContextMenu({ x: event.clientX, y: event.clientY, type: fileId ? 'file' : 'generic', fileId })
  }
  const runGlobalContextAction = async action => {
    const context = contextTargetRef.current || {}
    const target = context.element
    const editable = target?.closest?.('[contenteditable="true"], input:not([type="file"]), textarea')
    const flowNode = target?.closest?.('.react-flow__node')
    const nodeId = flowNode?.getAttribute('data-id')
    const selectedText = context.selectedText || ''
    const close = () => setGlobalContextMenu(null)
    try {
      if (context.fileId) {
        const file = items.find(item => item.id === context.fileId)
        if (!file) return
        if (action === 'open') { setActiveId(file.id); setSearch('') }
        if (action === 'rename') renameItem(file)
        if (action === 'duplicate') duplicateItem(file)
        if (action === 'delete') deleteItem(file)
        return
      }
      if (action === 'copy') {
        let text = selectedText
        if (!text && (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement)) {
          const start = editable.selectionStart ?? 0, end = editable.selectionEnd ?? 0
          text = editable.value.slice(start, end)
        }
        if (editable && text) { await navigator.clipboard?.writeText(text); showToast('Texto copiado') }
        else if (nodeId) window.dispatchEvent(new CustomEvent('atlas:context-copy', { detail: { id: nodeId } }))
        else if (text) { await navigator.clipboard?.writeText(text); showToast('Texto copiado') }
      } else if (action === 'paste') {
        if (editable) {
          const text = await navigator.clipboard?.readText()
          if (typeof text === 'string' && text.length) {
            editable.focus()
            if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
              const start = editable.selectionStart ?? editable.value.length, end = editable.selectionEnd ?? start
              editable.setRangeText(text, start, end, 'end')
              editable.dispatchEvent(new Event('input', { bubbles: true }))
            } else document.execCommand('insertText', false, normalizeClipboardInlineText(text))
          }
        } else window.dispatchEvent(new CustomEvent('atlas:context-paste'))
      } else if (action === 'select') {
        if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) { editable.focus(); editable.select() }
        else if (editable) {
          editable.focus()
          const range = document.createRange(); range.selectNodeContents(editable)
          const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
        } else window.dispatchEvent(new CustomEvent('atlas:context-select-all'))
      } else if (action === 'delete') {
        if (editable && selectedText) document.execCommand('delete', false)
        else if (nodeId) window.dispatchEvent(new CustomEvent('atlas:context-delete', { detail: { id: nodeId } }))
        else {
          const selection = window.getSelection()
          if (selection && !selection.isCollapsed) document.execCommand('delete', false)
          else showToast('Selecione um texto ou objeto para excluir.')
        }
      }
    } catch {
      if (action === 'paste') showToast('O navegador bloqueou o acesso à área de transferência. Use Ctrl+V.')
      else if (action === 'copy') showToast('Não foi possível copiar esse conteúdo.')
    } finally { close() }
  }

  return <div className="atlas-app" onContextMenu={handleGlobalContextMenu}>
    <header className="topbar">
      <button className="brand-button" onClick={() => { setActiveId(null); setSearch('') }} aria-label="Página inicial do Atlas"><span className="brand-mark" aria-hidden="true"><MapIcon size={22} strokeWidth={1.8} /></span><span className="brand-name">Atlas</span><span className="version-pill">1.7.4 Alpha</span></button>
      <div className="topbar-search"><Search size={15} /><input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && search.trim()) { const match = items.find(entry => entry.name.toLowerCase().includes(search.toLowerCase())); if (match) { setActiveId(match.id); setSearch('') } } }} placeholder="Buscar no Atlas…" aria-label="Buscar no Atlas" /><kbd><Command size={10} /> K</kbd></div>
      <div className="topbar-right"><span className={`save-indicator ${saveStatus !== 'Tudo salvo' ? 'pending' : ''}`}><span />{saveStatus}</span><button type="button" className="icon-button" title="Ajuda e atalhos" aria-label="Ajuda e atalhos" onClick={() => setHelpOpen(true)}><BookOpen size={16} /></button><button className="icon-button theme-toggle" title={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
        <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button" title="Opções do Atlas"><MoreHorizontal size={17} /></button></DropdownMenu.Trigger><AtlasDropdownContent className="menu-content" align="end" sideOffset={7}><DropdownMenu.Item className="menu-item" onSelect={exportBackup}><FileDown size={14} /> Exportar backup</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => importRef.current?.click()}><FileUp size={14} /> Importar backup</DropdownMenu.Item><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item" onSelect={() => setHelpOpen(true)}><BookOpen size={14} /> Ajuda e atalhos</DropdownMenu.Item></AtlasDropdownContent></DropdownMenu.Root>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importBackup} />
      </div>
    </header>
    <div className={`app-body ${explorerOpen ? '' : 'explorer-hidden'}`}>
      <main className="main-area">
        {!activeItem ? <HomeView items={visibleRootItems} search={search} onSearch={setSearch} onCreate={openCreate} onOpen={id => { setActiveId(id); setSearch('') }} onRename={renameItem} onDelete={deleteItem} onDuplicate={duplicateItem} onMove={openMoveDialog} />
          : activeItem.type === 'folder' ? <FolderView folder={activeItem} items={items.filter(entry => entry.parentId === activeItem.id)} search={search} onSearch={setSearch} onCreate={openCreate} onOpen={id => { setActiveId(id); setSearch('') }} onRename={renameItem} onDelete={deleteItem} onDuplicate={duplicateItem} onMove={openMoveDialog} onBack={() => { setActiveId(null); setSearch('') }} />
          : activeItem.type === 'canvas' ? <CanvasFlow key={activeItem.id} item={activeItem} onCanvasChange={onCanvasChange} onNameChange={name => updateItem(activeItem.id, { name })} onBackHome={() => { setActiveId(activeItem.parentId || null); setSearch('') }} onStoreImage={storeImage} showToast={showToast} documents={canvasDocuments} onDocumentContentChange={onDocumentContentChange} onDocumentNameChange={onDocumentNameChange} onOpenDocument={onOpenLinkedDocument} />
          : activeItem.type === 'image' ? <ImageFileView item={activeItem} onBack={() => { setActiveId(activeItem.parentId || null); setSearch('') }} />
          : <DocumentEditor key={activeItem.id} item={activeItem} onContentChange={content => updateItem(activeItem.id, { content })} onNameChange={name => updateItem(activeItem.id, { name })} onPageSizeChange={pageSize => updateItem(activeItem.id, { pageSize })} onMarginChange={margins => updateItem(activeItem.id, { margins })} onZoomChange={zoom => updateItem(activeItem.id, { zoom })} onStoreImage={storeImage} onNotice={showToast} />}
      </main>
      {explorerOpen && <aside className="sidebar" onDragOver={event => { if (event.target === event.currentTarget) event.preventDefault() }} onDrop={event => { if (event.target === event.currentTarget) { const id = event.dataTransfer.getData('text/atlas-item'); if (id) moveItem(items.find(entry => entry.id === id), null) } }}>
        <div className="explorer-header"><span>ARQUIVOS</span><div><button className="mini-plus" title="Adicionar imagem" aria-label="Adicionar imagem" onClick={() => imageLibraryInputRef.current?.click()}><ImageIcon size={14} /></button><button className="mini-plus" title="Criar arquivo" aria-label="Criar arquivo" onClick={() => openCreate('canvas')}><Plus size={15} /></button><button className="mini-plus" title="Ocultar explorador" aria-label="Ocultar explorador" onClick={() => setExplorerOpen(false)}><PanelRightClose size={15} /></button></div></div>
        <input ref={imageLibraryInputRef} type="file" accept="image/*" hidden onChange={addImageFromLibrary} />
        <button className={`nav-link ${!activeId ? 'current' : ''}`} onClick={() => { setActiveId(null); setSearch('') }}><span className="nav-link-icon"><House size={14} strokeWidth={1.8} aria-hidden="true" /></span><span>Início</span></button>
        <div className="sidebar-section-title"><span>ESPAÇO DE TRABALHO</span></div>
        <div className="sidebar-group"><div className="sidebar-group-heading"><span>PASTAS <i>{rootFolders.length || ''}</i></span><button className="mini-plus" title="Nova pasta" onClick={() => openCreate('folder')}><Plus size={13} /></button></div>{rootFolders.length ? rootFolders.map(renderFile) : <div className="sidebar-empty">Pastas aparecem aqui.</div>}</div>
        <div className="sidebar-group"><div className="sidebar-group-heading"><span>DOCUMENTOS <i>{recentDocuments.length || ''}</i></span><button className="mini-plus" title="Novo documento" onClick={() => openCreate('doc')}><Plus size={13} /></button></div>{recentDocuments.length ? recentDocuments.map(renderFile) : <div className="sidebar-empty">Nenhum documento.</div>}</div>
        <div className="sidebar-group"><div className="sidebar-group-heading"><span>CANVAS <i>{recentCanvases.length || ''}</i></span><button className="mini-plus" title="Novo canvas" onClick={() => openCreate('canvas')}><Plus size={13} /></button></div>{recentCanvases.length ? recentCanvases.map(renderFile) : <div className="sidebar-empty">Nenhum canvas.</div>}</div>
        <div className="sidebar-group"><div className="sidebar-group-heading"><span>IMAGENS <i>{rootImages.length || ''}</i></span><button className="mini-plus" title="Adicionar imagem" onClick={() => imageLibraryInputRef.current?.click()}><Plus size={13} /></button></div>{rootImages.length ? rootImages.map(renderFile) : <div className="sidebar-empty">Nenhuma imagem.</div>}</div>
        <div className="sidebar-bottom"><span className="privacy-dot" /><div><strong>Salvo neste dispositivo</strong><span>Backup disponível no menu.</span></div></div>
      </aside>}
      {!explorerOpen && <button className="reopen-explorer" title="Mostrar explorador" aria-label="Mostrar explorador" onClick={() => setExplorerOpen(true)}><PanelRightOpen size={16} /></button>}
    </div>
    <CreateDialog open={createOpen} onOpenChange={setCreateOpen} initialType={createType} onCreate={createItem} />
    <MoveDialog Select={AtlasSelect} item={movingItem} folders={folders.filter(folder => folder.id !== movingItem?.id && !(movingItem?.type === 'folder' && isDescendant(movingItem.id, folder.id)))} open={moveOpen} onOpenChange={setMoveOpen} onMove={moveItem} />
    <ConfirmDialog open={Boolean(pendingConfirm)} onOpenChange={open => { if (!open) setPendingConfirm(null) }} title={pendingConfirm?.title || 'Confirmar ação'} description={pendingConfirm?.description || ''} confirmLabel={pendingConfirm?.confirmLabel || 'Confirmar'} destructive={Boolean(pendingConfirm?.destructive)} onConfirm={pendingConfirm?.onConfirm} />
    <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    {globalContextMenu?.type === 'file' && <ImageContextMenu position={globalContextMenu} onClose={() => setGlobalContextMenu(null)} ariaLabel="Ações do arquivo" actions={[
      { label: 'Abrir', icon: FileText, onSelect: () => runGlobalContextAction('open') },
      { label: 'Renomear', icon: Pencil, onSelect: () => runGlobalContextAction('rename') },
      { label: 'Duplicar', icon: Copy, onSelect: () => runGlobalContextAction('duplicate') },
      { separator: true },
      { label: 'Excluir arquivo', icon: Trash2, danger: true, onSelect: () => runGlobalContextAction('delete') },
    ]} />}
    {globalContextMenu?.type === 'generic' && <ImageContextMenu position={globalContextMenu} onClose={() => setGlobalContextMenu(null)} ariaLabel="Ações rápidas" actions={[
      { label: 'Copiar', icon: Copy, disabled: !contextTargetRef.current?.selectedText && !contextTargetRef.current?.element?.closest?.('.react-flow__node'), onSelect: () => runGlobalContextAction('copy') },
      { label: 'Colar', icon: ClipboardPaste, onSelect: () => runGlobalContextAction('paste') },
      { label: 'Selecionar tudo', icon: Type, onSelect: () => runGlobalContextAction('select') },
      { separator: true },
      { label: 'Excluir', icon: Trash2, danger: true, disabled: !contextTargetRef.current?.selectedText && !contextTargetRef.current?.element?.closest?.('.react-flow__node'), onSelect: () => runGlobalContextAction('delete') },
    ]} />}
    <div className={`toast ${toast ? 'visible' : ''}`} role="status"><Check size={14} />{toast}</div>
  </div>
}

