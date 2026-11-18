import FormatAlignCenterRoundedIcon from '@mui/icons-material/FormatAlignCenterRounded'
import FormatAlignLeftRoundedIcon from '@mui/icons-material/FormatAlignLeftRounded'
import FormatAlignRightRoundedIcon from '@mui/icons-material/FormatAlignRightRounded'
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded'
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded'
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded'
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded'
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded'
import FormatStrikethroughRoundedIcon from '@mui/icons-material/FormatStrikethroughRounded'
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import RedoRoundedIcon from '@mui/icons-material/RedoRounded'
import TitleRoundedIcon from '@mui/icons-material/TitleRounded'
import UndoRoundedIcon from '@mui/icons-material/UndoRounded'
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { Field } from '@/shared/ui/Field'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { richTextSchema, type RichTextDocument } from '@/domain/content'
import { isSafeHref } from '@/domain/href'
import { useI18n } from '@/shared/i18n/i18n-context'
import type { MessageKey } from '@/shared/i18n/messages'
import { GhostButton, PrimaryButton } from '@/shared/ui/buttons'
import { R, T } from '@/theme/tokens'
import { documentToTiptap, tiptapToDocument } from './tiptapDocument'

/**
 * Editor de contenido enriquecido, sobre TipTap (ProseMirror).
 *
 * ## Editor de paquete, documento de EBIM
 *
 * Se usa un editor mantenido en vez de uno de casa: la edición sobre
 * `contentEditable` es un pozo de casos raros —composición de acentos, pegar
 * desde Word, deshacer, selección con teclado— que no merece la pena volver a
 * resolver. Lo que NO se adopta es su formato: TipTap pone la cara y lo que se
 * guarda es el documento del dominio (`tiptapDocument.ts`), que es lo que
 * valida `richTextSchema` y lo que acepta el CHECK de Postgres.
 *
 * Por eso aquí no hay `dangerouslySetInnerHTML` ni HTML almacenado: TipTap
 * pinta su superficie con nodos de ProseMirror y de aquí sale un array plano de
 * nodos. El test de arquitectura que prohíbe el `innerHTML` sigue verde y el
 * contenido del tenant sigue sin poder llevar una etiqueta.
 *
 * ## La barra enseña exactamente lo que el dominio sabe guardar
 *
 * Ni un botón más. Tablas, imágenes en línea, colores y tipografías no están
 * porque el vocabulario no los tiene (`src/domain/content.ts`), y ofrecer un
 * formato que se pierde en silencio al guardar es peor que no ofrecerlo: el
 * trabajo desaparece sin avisar. Cuando el vocabulario gane un nodo, se
 * enciende su extensión y se añade su botón.
 *
 * ## El formato es el de la vitrina
 *
 * La superficie se pinta con los tokens de EBIM y con las medidas que `RichText`
 * da en la tienda —titular a `pageTitle`, cita con su barra de acento, lista con
 * su sangría—, así que lo que se escribe ya es la vista previa y no hay dos
 * sitios donde mirar.
 */

type BlockKind = 'paragraph' | 'heading' | 'subheading' | 'list' | 'orderedList' | 'quote'

const BLOCK_LABEL: Record<BlockKind, MessageKey> = {
  paragraph: 'content.editor.paragraph',
  heading: 'content.editor.heading',
  subheading: 'content.editor.subheading',
  list: 'content.editor.list',
  orderedList: 'content.editor.orderedList',
  quote: 'content.editor.quote',
}

const BLOCK_ICON: Record<BlockKind, ReactNode> = {
  paragraph: <NotesRoundedIcon fontSize="small" />,
  heading: <TitleRoundedIcon fontSize="small" />,
  subheading: <TitleRoundedIcon sx={{ fontSize: 15 }} />,
  list: <FormatListBulletedRoundedIcon fontSize="small" />,
  orderedList: <FormatListNumberedRoundedIcon fontSize="small" />,
  quote: <FormatQuoteRoundedIcon fontSize="small" />,
}

/** El orden de la barra es el de uso, no el del enum: se escribe más de lo que se titula. */
const BLOCKS: BlockKind[] = ['paragraph', 'heading', 'subheading', 'list', 'orderedList', 'quote']

type MarkKind = 'bold' | 'italic' | 'underline' | 'strike'

const MARK_LABEL: Record<MarkKind, MessageKey> = {
  bold: 'content.editor.bold',
  italic: 'content.editor.italic',
  underline: 'content.editor.underline',
  strike: 'content.editor.strike',
}

const MARK_ICON: Record<MarkKind, ReactNode> = {
  bold: <FormatBoldRoundedIcon fontSize="small" />,
  italic: <FormatItalicRoundedIcon fontSize="small" />,
  underline: <FormatUnderlinedRoundedIcon fontSize="small" />,
  strike: <FormatStrikethroughRoundedIcon fontSize="small" />,
}

const MARKS: MarkKind[] = ['bold', 'italic', 'underline', 'strike']

type AlignKind = 'left' | 'center' | 'right'

const ALIGN_LABEL: Record<AlignKind, MessageKey> = {
  left: 'content.editor.alignLeft',
  center: 'content.editor.alignCenter',
  right: 'content.editor.alignRight',
}

const ALIGN_ICON: Record<AlignKind, ReactNode> = {
  left: <FormatAlignLeftRoundedIcon fontSize="small" />,
  center: <FormatAlignCenterRoundedIcon fontSize="small" />,
  right: <FormatAlignRightRoundedIcon fontSize="small" />,
}

const ALIGNS: AlignKind[] = ['left', 'center', 'right']

export function RichTextEditor({
  value,
  onChange,
  label,
  helperText,
  disabled = false,
}: {
  value: RichTextDocument | null
  onChange: (next: RichTextDocument | null) => void
  label: string
  helperText?: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  // Lo último que este editor emitió. Sin esta marca, el documento que vuelve
  // del formulario se confundiría con un cambio de fuera, y remontar el
  // contenido mandaría el cursor al principio a media frase.
  const emitted = useRef(value)
  const [linkDraft, setLinkDraft] = useState<string | null>(null)

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Encendido: lo que el dominio sabe guardar.
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          // El editor no decide qué esquemas valen: se los pregunta al mismo
          // guard que el CHECK de la base y que el renderizador de la vitrina.
          isAllowedUri: (url) => isSafeHref(url),
        },
        // Apagado: lo que no cabe en el vocabulario de cinco nodos.
        code: false,
        codeBlock: false,
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: documentToTiptap(value),
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
      },
    },
    onUpdate: ({ editor: instance }) => {
      const next = tiptapToDocument(instance.getJSON())
      emitted.current = next
      onChange(next)
    },
  })

  // Cambios que NO vienen de teclear aquí: abrir otro bloque, o Cancelar.
  useEffect(() => {
    if (!editor || JSON.stringify(value) === JSON.stringify(emitted.current)) return
    emitted.current = value
    editor.commands.setContent(documentToTiptap(value), { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      block: blockOf(instance),
      marks: MARKS.filter((mark) => instance?.isActive(mark) ?? false),
      align: ALIGNS.find((align) => instance?.isActive({ textAlign: align }) ?? false) ?? 'left',
      link: instance?.isActive('link') ?? false,
      canUndo: instance?.can().undo() ?? false,
      canRedo: instance?.can().redo() ?? false,
    }),
  })

  /**
   * El mismo juicio que dará Guardar, pero mientras se escribe.
   *
   * Enterarse al enviar de que una línea lleva una etiqueta obliga a buscarla
   * entre veinte; aquí se dice en el momento y con el mismo mensaje. Quien
   * decide es `richTextSchema`, que es la mitad de cliente del CHECK.
   */
  const problem = useMemo(() => {
    if (value === null) return null
    const parsed = richTextSchema.safeParse(value)
    if (parsed.success) return null
    const message = parsed.error.issues[0]?.message ?? ''
    return message.startsWith('content.') ? message : 'content.error.body'
  }, [value])

  function applyBlock(kind: BlockKind) {
    if (!editor) return
    const chain = editor.chain().focus()
    switch (kind) {
      case 'heading':
        chain.setNode('heading', { level: 2 }).run()
        break
      case 'subheading':
        chain.setNode('heading', { level: 3 }).run()
        break
      case 'list':
        chain.toggleBulletList().run()
        break
      case 'orderedList':
        chain.toggleOrderedList().run()
        break
      case 'quote':
        chain.toggleBlockquote().run()
        break
      default:
        // Volver a párrafo es DESHACER lo que hubiera: `setParagraph` a solas no
        // saca de una lista ni de una cita, y el botón se quedaría sin efecto
        // justo en los dos sitios donde más se pulsa.
        chain.liftListItem('listItem').run()
        editor.chain().focus().unsetBlockquote().setParagraph().run()
    }
  }

  function confirmLink() {
    if (!editor || linkDraft === null) return
    const href = linkDraft.trim()
    if (href === '') {
      editor.chain().focus().unsetLink().run()
    } else if (isSafeHref(href)) {
      // `extendMarkRange`: con el cursor dentro de una palabra ya enlazada, el
      // enlace nuevo sustituye al viejo entero en vez de partirlo en dos.
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setLinkDraft(null)
  }

  const linkInvalid = linkDraft !== null && linkDraft.trim() !== '' && !isSafeHref(linkDraft.trim())

  return (
    <Stack spacing={1}>
      <Typography sx={{ fontWeight: 700, fontSize: T.bodyStrong }}>{label}</Typography>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}
      >
        {/* La barra dice DÓNDE está el cursor, no solo qué se puede pulsar: el
            botón activo es el formato del bloque que se está escribiendo. */}
        <ToggleButtonGroup
          exclusive
          size="small"
          value={state?.block ?? 'paragraph'}
          aria-label={t('content.editor.toolbar')}
          disabled={disabled}
          onChange={(_, next: BlockKind | null) => next && applyBlock(next)}
        >
          {BLOCKS.map((kind) => (
            <ToggleButton key={kind} value={kind} aria-label={t(BLOCK_LABEL[kind])}>
              <Tooltip title={t(BLOCK_LABEL[kind])}>
                <Box sx={{ display: 'flex' }}>{BLOCK_ICON[kind]}</Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <ToggleButtonGroup
          size="small"
          value={state?.marks ?? []}
          aria-label={t('content.editor.marks')}
          disabled={disabled}
          onChange={(_, next: MarkKind[]) => {
            // `ToggleButtonGroup` múltiple devuelve la lista entera; la marca
            // que hay que conmutar es la que ha cambiado.
            const before = state?.marks ?? []
            const changed =
              next.find((mark) => !before.includes(mark)) ??
              before.find((mark) => !next.includes(mark))
            if (changed) editor?.chain().focus().toggleMark(changed).run()
          }}
        >
          {MARKS.map((mark) => (
            <ToggleButton key={mark} value={mark} aria-label={t(MARK_LABEL[mark])}>
              <Tooltip title={t(MARK_LABEL[mark])}>
                <Box sx={{ display: 'flex' }}>{MARK_ICON[mark]}</Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <ToggleButtonGroup
          exclusive
          size="small"
          value={state?.align ?? 'left'}
          aria-label={t('content.editor.align')}
          disabled={disabled}
          onChange={(_, next: AlignKind | null) =>
            next && editor?.chain().focus().setTextAlign(next).run()
          }
        >
          {ALIGNS.map((align) => (
            <ToggleButton key={align} value={align} aria-label={t(ALIGN_LABEL[align])}>
              <Tooltip title={t(ALIGN_LABEL[align])}>
                <Box sx={{ display: 'flex' }}>{ALIGN_ICON[align]}</Box>
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <ToolbarButton
          label={t('content.editor.link')}
          disabled={disabled}
          onClick={() => setLinkDraft(currentHref(editor))}
        >
          <LinkRoundedIcon fontSize="small" />
        </ToolbarButton>
        <ToolbarButton
          label={t('content.editor.unlink')}
          disabled={disabled || !state?.link}
          onClick={() => editor?.chain().focus().unsetLink().run()}
        >
          <LinkOffRoundedIcon fontSize="small" />
        </ToolbarButton>
        <ToolbarButton
          label={t('content.editor.divider')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <HorizontalRuleRoundedIcon fontSize="small" />
        </ToolbarButton>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {/* Deshacer y rehacer los trae ProseMirror, y es media razón para usar
            un editor de paquete: en un `<textarea>` los daba el navegador y se
            perdían en cuanto el formato lo aplicaba un botón. */}
        <ToolbarButton
          label={t('content.editor.undo')}
          disabled={disabled || !state?.canUndo}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <UndoRoundedIcon fontSize="small" />
        </ToolbarButton>
        <ToolbarButton
          label={t('content.editor.redo')}
          disabled={disabled || !state?.canRedo}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <RedoRoundedIcon fontSize="small" />
        </ToolbarButton>
      </Stack>

      <Box
        sx={{
          border: '1px solid',
          borderColor: problem ? 'var(--red)' : 'var(--border)',
          borderRadius: `${R.md}px`,
          bgcolor: disabled ? 'var(--neutral-soft)' : 'var(--card)',
          transition: 'border-color 120ms',
          '&:focus-within': { borderColor: 'var(--accent)' },
          '& .ProseMirror': {
            minHeight: 200,
            p: 1.75,
            outline: 'none',
            color: 'var(--text)',
            fontSize: T.body,
            lineHeight: 1.7,
            display: 'grid',
            gap: '10px',
          },
          '& .ProseMirror > *': { margin: 0 },
          '& .ProseMirror h2': { fontSize: T.pageTitle, fontWeight: 800, letterSpacing: '-0.3px' },
          '& .ProseMirror h3': { fontSize: T.cardTitle, fontWeight: 800, letterSpacing: '-0.2px' },
          '& .ProseMirror ul, & .ProseMirror ol': {
            paddingLeft: 22,
            margin: 0,
            display: 'grid',
            gap: '4px',
          },
          '& .ProseMirror blockquote': {
            paddingLeft: 16,
            borderLeft: '3px solid var(--accent)',
            color: 'var(--muted)',
            fontStyle: 'italic',
          },
          '& .ProseMirror hr': {
            border: 0,
            borderTop: '1px solid var(--border)',
            margin: '4px 0',
          },
          // El enlace se pinta con el token AA, igual que en la vitrina: el
          // acento puro como color de texto no pasa contraste.
          '& .ProseMirror a': { color: 'var(--accent-deep)', fontWeight: 700 },
        }}
      >
        <EditorContent editor={editor} />
      </Box>

      <Typography
        sx={{
          fontSize: 12,
          color: problem ? 'var(--red)' : 'var(--muted)',
          fontWeight: problem ? 600 : 400,
        }}
      >
        {problem ? t(problem as MessageKey) : helperText}
      </Typography>

      {/* El enlace se pide en un diálogo y no escribiendo la URL en el texto:
          así el destino se valida ANTES de entrar en el documento, con el mismo
          guard que usa la base. */}
      <Dialog open={linkDraft !== null} onClose={() => setLinkDraft(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('content.editor.link')}</DialogTitle>
        <DialogContent>
          <Field
            autoFocus
            rule="url"
            fullWidth
            size="small"
            margin="dense"
            value={linkDraft ?? ''}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !linkInvalid) {
                event.preventDefault()
                confirmLink()
              }
            }}
            error={linkInvalid}
            helperText={linkInvalid ? t('content.error.href') : t('content.blocks.ctaHrefHelp')}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': t('content.editor.linkHref') } }}
            label={t('content.editor.linkHref')}
          />
        </DialogContent>
        <DialogActions>
          <GhostButton onClick={() => setLinkDraft(null)}>{t('common.cancel')}</GhostButton>
          <PrimaryButton onClick={confirmLink} disabled={linkInvalid}>
            {t('common.save')}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip title={label}>
      {/* El `span` es para que el tooltip siga apareciendo cuando el botón está
          deshabilitado: un botón apagado no emite eventos de ratón. */}
      <span>
        <IconButton size="small" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </IconButton>
      </span>
    </Tooltip>
  )
}

function blockOf(editor: Editor | null): BlockKind {
  if (!editor) return 'paragraph'
  if (editor.isActive('heading', { level: 2 })) return 'heading'
  if (editor.isActive('heading', { level: 3 })) return 'subheading'
  if (editor.isActive('orderedList')) return 'orderedList'
  if (editor.isActive('bulletList')) return 'list'
  if (editor.isActive('blockquote')) return 'quote'
  return 'paragraph'
}

/** El destino del enlace donde está el cursor, para poder editarlo en vez de rehacerlo. */
function currentHref(editor: Editor | null): string {
  const href = editor?.getAttributes('link').href
  return typeof href === 'string' ? href : ''
}
