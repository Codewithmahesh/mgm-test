'use client'

import { useRef, useState } from 'react'
import { Check, Image as ImageIcon, Loader2, Paperclip, Trash2, UploadCloud, X, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, useFeedback } from '@/components/ui/overlay'
import { uploadFileToCloudinary } from '@/lib/imageuploader'
import { cn } from '@/lib/utils'

/**
 * Action button to attach, preview, or remove an image associated with a question.
 * Positioned in question card action bars beside Edit, Delete, and Expand.
 */
export function QuestionAttachmentButton({
  imageUrl,
  onImageChange,
  className,
}: {
  imageUrl?: string
  onImageChange: (url: string) => Promise<void> | void
  className?: string
}) {
  const { toast } = useFeedback()
  const [uploading, setUploading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelected = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Please choose a valid image file (PNG, JPG, WebP, etc.).', 'error')
      return
    }
    setUploading(true)
    try {
      const url = await uploadFileToCloudinary(file)
      await onImageChange(url)
      toast('Image attached to question successfully.')
      setModalOpen(false)
    } catch (err) {
      console.error('Failed to attach image:', err)
      toast(err instanceof Error ? err.message : 'Failed to upload image.', 'error')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelected(file)
  }

  const handleRemove = async () => {
    setUploading(true)
    try {
      await onImageChange('')
      toast('Attached image removed.')
      setModalOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove image.', 'error')
    } finally {
      setUploading(false)
    }
  }

  const handleClick = () => {
    if (imageUrl) {
      // If image already exists, open preview and management modal
      setModalOpen(true)
    } else {
      // If no image, open file picker directly
      fileInputRef.current?.click()
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleInputChange}
      />

      <button
        type="button"
        onClick={handleClick}
        disabled={uploading}
        aria-label={imageUrl ? 'Manage attached image' : 'Attach image to question'}
        title={imageUrl ? 'Image attached · Click to view or replace' : 'Attach diagram / image'}
        className={cn(
          'relative rounded p-1.5 transition-colors',
          imageUrl
            ? 'bg-primary-soft/80 text-primary hover:bg-primary-soft hover:text-primary font-medium'
            : 'text-subtle hover:bg-muted hover:text-foreground',
          className
        )}
      >
        {uploading ? (
          <Loader2 className="size-3.5 animate-spin text-primary" />
        ) : (
          <>
            <Paperclip className="size-3.5" />
            {imageUrl && (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-card" />
            )}
          </>
        )}
      </button>

      {/* Modal to view, replace or remove already attached image */}
      {modalOpen && imageUrl && (
        <Dialog
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Attached Question Image"
          description="This diagram or image will be shown right after the question text and before the options."
          footer={
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemove}
                disabled={uploading}
              >
                <Trash2 className="size-3.5" /> Remove Image
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <UploadCloud className="size-3.5" /> Replace Image
                </Button>
                <Button size="sm" onClick={() => setModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          }
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="relative max-h-[380px] w-full overflow-hidden rounded-lg border border-border bg-muted/20 p-2 text-center">
              <img
                src={imageUrl}
                alt="Question attachment"
                className="mx-auto max-h-[360px] w-auto max-w-full rounded object-contain"
              />
            </div>
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline underline-offset-2 hover:text-primary-strong"
            >
              Open original full-size image in new tab
            </a>
          </div>
        </Dialog>
      )}
    </>
  )
}

/**
 * Embedded drag-and-drop or click uploader for QuestionEditor modal.
 */
export function QuestionImageUpload({
  imageUrl,
  onChange,
}: {
  imageUrl?: string
  onChange: (url: string) => void
}) {
  const { toast } = useFeedback()
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Please upload an image file (PNG, JPG, WebP, etc.).', 'error')
      return
    }
    setUploading(true)
    try {
      const url = await uploadFileToCloudinary(file)
      onChange(url)
      toast('Image uploaded successfully.')
    } catch (err) {
      console.error(err)
      toast(err instanceof Error ? err.message : 'Failed to upload image.', 'error')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-foreground">
          Attached Image / Diagram
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            (Displayed after question and before options)
          </span>
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {imageUrl ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-md border border-border bg-card">
              <img
                src={imageUrl}
                alt="Attached diagram"
                className="size-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Check className="size-3.5 text-success" /> Image attached
              </p>
              <a
                href={imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 block truncate text-[11px] text-muted-foreground hover:text-primary hover:underline"
              >
                {imageUrl}
              </a>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <UploadCloud className="size-3" /> Change
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-danger hover:bg-danger-soft hover:text-danger"
              onClick={() => onChange('')}
              disabled={uploading}
            >
              <Trash2 className="size-3" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={e => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center transition-colors',
            dragOver
              ? 'border-primary bg-primary-soft/50'
              : 'border-border hover:border-border-strong hover:bg-muted/30'
          )}
        >
          {uploading ? (
            <div className="flex items-center gap-2 py-2 text-xs font-medium text-primary">
              <Loader2 className="size-4 animate-spin" /> Uploading image to Cloudinary…
            </div>
          ) : (
            <>
              <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Paperclip className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground">
                  Click to upload or drag and drop image / diagram
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  PNG, JPG, WebP up to 10MB (automatically compressed)
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Clean responsive preview for attached image displayed after question and before options.
 */
export function QuestionImageDisplay({
  src,
  alt = 'Question diagram',
  className,
}: {
  src?: string
  alt?: string
  className?: string
}) {
  const [fullscreen, setFullscreen] = useState(false)
  if (!src) return null

  return (
    <>
      <div
        className={cn(
          'group relative my-3 inline-block max-w-full overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xs',
          className
        )}
      >
        <div className="relative overflow-hidden rounded-md bg-muted/20">
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="max-h-72 w-auto max-w-full rounded object-contain transition-transform duration-200 group-hover:scale-[1.01]"
          />
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label="View full image"
            title="Click to expand full image"
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white shadow-sm opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100"
          >
            <ZoomIn className="size-3" /> Zoom
          </button>
        </div>
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs"
          onClick={() => setFullscreen(false)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg bg-card p-2">
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="absolute top-3 right-3 z-10 rounded-full bg-black/70 p-1.5 text-white hover:bg-black"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
            <img
              src={src}
              alt={alt}
              className="max-h-[85vh] w-auto max-w-full rounded object-contain"
            />
          </div>
        </div>
      )}
    </>
  )
}
