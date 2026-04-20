import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const { "aria-invalid": ariaInvalid, ...rest } = props
  const isInvalid = ariaInvalid === true

  return (
    <textarea
      data-slot="textarea"
      aria-invalid={isInvalid ? true : undefined}
      data-invalid={isInvalid ? true : undefined}
      className={cn(
        "border-input dark:bg-input/30 text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 group-data-[invalid=true]/field:border-destructive dark:group-data-[invalid=true]/field:border-destructive/50 group-data-[invalid=true]/field:ring-destructive/20 dark:group-data-[invalid=true]/field:ring-destructive/40 group-data-[invalid=true]/field:ring-[3px] data-[invalid=true]:border-destructive dark:data-[invalid=true]:border-destructive/50 data-[invalid=true]:ring-destructive/20 dark:data-[invalid=true]:ring-destructive/40 data-[invalid=true]:ring-[3px] disabled:bg-input/50 dark:disabled:bg-input/80 rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors focus-visible:ring-[3px] aria-invalid:ring-[3px] md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...rest}
    />
  )
}

export { Textarea }
