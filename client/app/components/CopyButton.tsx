"use client";

import { toast } from "sonner";

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success(label ? `${label} copied` : "Copied to clipboard");
      }}
      title={label ? `Copy ${label}` : "Copy"}
      className={className ?? "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors shrink-0"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  );
}
