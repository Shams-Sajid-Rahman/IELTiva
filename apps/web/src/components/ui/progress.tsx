"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  // Starts empty and fills to its value, so every progress bar animates the same way.
  const [shown, setShown] = React.useState(0)
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value ?? 0))
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-transform duration-700 ease-out"
        style={{ transform: `translateX(-${100 - shown}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
