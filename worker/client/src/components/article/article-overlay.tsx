import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog'

interface ArticleOverlayProps {
  articleUrl: string | null
  onClose: () => void
}

// ArticleDetail is implemented in Unit 6. This overlay will be wired up then.
export function ArticleOverlay({ articleUrl, onClose }: ArticleOverlayProps) {
  return (
    <Dialog open={!!articleUrl} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPortal>
        <DialogOverlay className="duration-300" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-[70] w-full md:w-2/3 bg-bg shadow-2xl overflow-y-auto overscroll-contain data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-300"
          aria-describedby={undefined}
          data-keyboard-nav-passthrough=""
        >
          <DialogTitle className="sr-only">Article</DialogTitle>
          {/* Close button */}
          <div className="sticky top-0 z-10 flex items-center h-12 px-4 bg-bg/80 backdrop-blur-sm border-b border-border" style={{ paddingTop: 'var(--safe-area-inset-top)' }}>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-hover transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted" />
            </button>
          </div>
          {/* ArticleDetail placeholder — implemented in Unit 6 */}
          {articleUrl && (
            <div className="p-4 text-muted text-sm">
              {articleUrl}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
