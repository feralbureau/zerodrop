import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

type FieldGroupProps = React.ComponentProps<"div">
type FieldProps = React.ComponentProps<"div">
type FieldLabelProps = React.ComponentProps<"label">
type FieldDescriptionProps = React.ComponentProps<"p">

export function FieldGroup({ className, ...props }: FieldGroupProps) {
  return <div className={cn("flex flex-col gap-4", className)} {...props} />
}

export function Field({ className, ...props }: FieldProps) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />
}

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return (
    <label className={cn("text-sm font-medium", className)} {...props} />
  )
}

export function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)} {...props} />
  )
}
