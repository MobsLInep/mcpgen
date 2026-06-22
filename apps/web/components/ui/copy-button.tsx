"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";

export interface CopyButtonProps extends Omit<ButtonProps, "onClick"> {
  /** Text to copy, or a function that resolves to it (e.g. a fetch). */
  getText: () => string | Promise<string>;
  label: string;
  copiedLabel?: string;
}

export function CopyButton({
  getText,
  label,
  copiedLabel = "Copied",
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      {...props}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(await getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // clipboard may be blocked; ignore
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
