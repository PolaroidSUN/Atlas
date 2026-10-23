import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FilePlus2, FileText, FolderPlus, Network, Plus, Search, X } from 'lucide-react'

function fileKind(type) {
  return ({ canvas: 'Canvas', doc: 'Documento', folder: 'Pasta', image: 'Imagem' })[type] || 'Arquivo'
}
export function CreateDialog({ open, onOpenChange, initialType = 'canvas', onCreate }) {
  const [type, setType] = useState(initialType)
  const [name, setName] = useState('')
  const inputRef = useRef(null)
  useEffect(() => {
    if (!open) return
    setType(initialType); setName('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, initialType])
  const submit = event => {
    event.preventDefault()
    onCreate(type, name.trim() || `Novo ${fileKind(type).toLowerCase()}`)
    onOpenChange(false)
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content">
        <div className="dialog-heading"><div><Dialog.Title className="dialog-title">Criar novo</Dialog.Title><Dialog.Description className="dialog-description">Escolha o tipo e dê um nome ao arquivo.</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Fechar"><X size={16} /></button></Dialog.Close></div>
        <form onSubmit={submit}>
          <div className="creation-types" role="group" aria-label="Tipo de arquivo">
            <button type="button" onClick={() => setType('canvas')} className={`creation-type ${type === 'canvas' ? 'selected' : ''}`}><span className="creation-type-icon canvas-tone"><Network size={17} /></span><span><strong>Canvas</strong><small>Organize ideias visualmente</small></span></button>
            <button type="button" onClick={() => setType('doc')} className={`creation-type ${type === 'doc' ? 'selected' : ''}`}><span className="creation-type-icon doc-tone"><FileText size={17} /></span><span><strong>Documento</strong><small>Escreva e formate textos</small></span></button>
            <button type="button" onClick={() => setType('folder')} className={`creation-type ${type === 'folder' ? 'selected' : ''}`}><span className="creation-type-icon folder-tone"><FolderPlus size={17} /></span><span><strong>Pasta</strong><small>Agrupe seus arquivos</small></span></button>
          </div>
          <label className="field-label" htmlFor="new-item-name">Nome</label>
          <input ref={inputRef} id="new-item-name" className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder={type === 'canvas' ? 'Ex.: Planejamento' : type === 'doc' ? 'Ex.: Anotações' : 'Ex.: Trabalho'} maxLength={90} />
          <div className="dialog-footer"><Dialog.Close asChild><button type="button" className="action-button quiet">Cancelar</button></Dialog.Close><button type="submit" className="action-button primary"><Plus size={15} /> Criar {fileKind(type).toLowerCase()}</button></div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}


export function InsertDocumentDialog({ open, onOpenChange, documents, onChoose }) {
  const [query, setQuery] = useState('')
  useEffect(() => { if (open) setQuery('') }, [open])
  const visible = (documents || []).filter(doc => (doc.name || '').toLowerCase().includes(query.toLowerCase()))
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content insert-document-dialog">
      <div className="dialog-heading"><div><Dialog.Title className="dialog-title">Inserir documento no canvas</Dialog.Title><Dialog.Description className="dialog-description">Escolha uma nota completa. O cartão fica editável e sincronizado com o documento original.</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="Fechar"><X size={16} /></button></Dialog.Close></div>
      <label className="document-picker-search"><Search size={14} /><input className="text-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar documentos…" /></label>
      <div className="document-picker-list">
        {visible.map(doc => <button type="button" key={doc.id} className="document-picker-item" onMouseDown={event => event.preventDefault()} onClick={() => { onChoose(doc); onOpenChange(false) }}>
          <span className="document-picker-icon"><FileText size={16} /></span><span className="document-picker-copy"><strong>{doc.name || 'Sem título'}</strong><small>{(doc.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110) || 'Documento vazio'}</small></span><FilePlus2 size={15} />
        </button>)}
        {!visible.length && <div className="document-picker-empty">{documents?.length ? 'Nenhum documento corresponde à busca.' : 'Crie um documento primeiro para inseri-lo no canvas.'}</div>}
      </div>
      <div className="dialog-footer"><Dialog.Close asChild><button type="button" className="action-button quiet">Cancelar</button></Dialog.Close></div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}

export function TableDialog({ open, onOpenChange, onCreate }) {
  const [rows, setRows] = useState(5)
  const [cols, setCols] = useState(4)
  useEffect(() => { if (open) { setRows(5); setCols(4) } }, [open])
  const submit = event => {
    event.preventDefault()
    onCreate(Math.max(1, Math.min(30, Number(rows) || 5)), Math.max(1, Math.min(16, Number(cols) || 4)))
    onOpenChange(false)
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content table-dialog">
      <div className="dialog-heading"><div><Dialog.Title className="dialog-title">Nova tabela</Dialog.Title><Dialog.Description className="dialog-description">Defina as dimensões. Você poderá editar as células depois.</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Fechar"><X size={16} /></button></Dialog.Close></div>
      <form onSubmit={submit}>
        <div className="table-fields"><label className="field-label">Linhas<input className="text-input" type="number" min="1" max="30" value={rows} onChange={e => setRows(e.target.value)} /></label><label className="field-label">Colunas<input className="text-input" type="number" min="1" max="16" value={cols} onChange={e => setCols(e.target.value)} /></label></div>
        <p className="field-help">Máximo de 30 linhas e 16 colunas por tabela.</p>
        <div className="dialog-footer"><Dialog.Close asChild><button type="button" className="action-button quiet">Cancelar</button></Dialog.Close><button type="submit" className="action-button primary">Criar tabela</button></div>
      </form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}

