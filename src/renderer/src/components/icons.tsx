export {
  BookText as BookTextIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronUp as ChevronUpIcon,
  File as FileIcon,
  FileSignature as FileSignatureIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  LibraryBig as LibraryBigIcon,
  Minus as MinusIcon,
  Moon as MoonIcon,
  Pencil as PencilIcon,
  Plus as PlusIcon,
  RefreshCw as RefreshIcon,
  Search as SearchIcon,
  Sun as SunIcon,
  Link as LinkIcon,
  Trash2 as TrashIcon,
  X as XIcon
} from 'lucide-react'

interface IconProps {
  className?: string
}

/** Document with folded corner and "PDF" — for PDF files. */
export function PdfIcon({ className = 'h-4 w-4' }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v4a2 2 0 0 0 2 2h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="6.5"
        fontWeight="700"
        fill="currentColor"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        PDF
      </text>
    </svg>
  )
}

/** Document with folded corner and "MD" — for Markdown files. */
export function MarkdownIcon({ className = 'h-4 w-4' }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v4a2 2 0 0 0 2 2h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="6.5"
        fontWeight="700"
        fill="currentColor"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        MD
      </text>
    </svg>
  )
}
