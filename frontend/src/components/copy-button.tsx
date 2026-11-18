'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';

interface CopyButtonProps {
  /** Called at click time so large texts are only built when needed. */
  getText: () => string;
  label?: string;
  /** What was copied, for the confirmation: "Transcript copied". */
  subject: string;
  variant?: 'outline' | 'ghost' | 'secondary';
  size?: 'sm' | 'default' | 'icon-sm';
  className?: string;
}

export function CopyButton({ getText, label = 'Copy', subject, variant = 'outline', size = 'sm', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleClick = async () => {
    const ok = await copyText(getText());
    if (!ok) {
      toast.error("Couldn't copy to the clipboard", { description: 'Your browser blocked clipboard access. Select the text and copy it manually.' });
      return;
    }
    toast.success(`${subject} copied`);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  const iconOnly = size === 'icon-sm';
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={handleClick}
      aria-label={iconOnly ? `Copy ${subject.toLowerCase()}` : undefined}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
      {!iconOnly && (copied ? 'Copied' : label)}
    </Button>
  );
}
