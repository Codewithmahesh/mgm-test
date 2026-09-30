import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        outline: 'border-border-strong bg-card text-foreground shadow-xs hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive: 'bg-danger text-white shadow-xs hover:bg-danger-hover',
        'destructive-outline': 'border-danger-border bg-card text-danger hover:bg-danger-soft',
        success: 'bg-success text-white shadow-xs hover:bg-success-hover',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-[13px]',
        xs: "h-7 gap-1.5 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 px-4',
        xl: 'h-11 px-5 text-[15px]',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-xs': "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

/** `loading` disables the button and swaps its icon for a spinner while an action runs. */
function Button({ className, variant = 'default', size = 'default', loading = false, disabled, children, ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <ButtonPrimitive data-slot="button" aria-busy={loading || undefined} disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }), loading && '[&>svg]:hidden')} {...props}>
      {loading && <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" />}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
