import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const { "aria-invalid": ariaInvalid, ...rest } = props
  const isInvalid = ariaInvalid === true

  return (
    <input
      type={type}
      data-slot="input"
      aria-invalid={isInvalid ? true : undefined}
      data-invalid={isInvalid ? true : undefined}
      className={cn(
        "dark:bg-input/30 border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 group-data-[invalid=true]/field:border-destructive dark:group-data-[invalid=true]/field:border-destructive/50 group-data-[invalid=true]/field:ring-destructive/20 dark:group-data-[invalid=true]/field:ring-destructive/40 group-data-[invalid=true]/field:ring-[3px] data-[invalid=true]:!border-destructive dark:data-[invalid=true]:!border-destructive/50 data-[invalid=true]:ring-destructive/20 dark:data-[invalid=true]:ring-destructive/40 data-[invalid=true]:ring-[3px] focus-visible:data-[invalid=true]:!border-destructive dark:focus-visible:data-[invalid=true]:!border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium focus-visible:ring-[3px] aria-invalid:ring-[3px] md:text-sm file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...rest}
    />
  )
}

export { Input }
