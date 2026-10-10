import { Loader2, AlertCircle, CheckCircle2, Wallet, Shield, FileText, Users } from "lucide-react";

// ── Loading Spinner ───────────────────────────────────────────────────────────

export function LoadingSpinner({ size = "md", text }: { size?: "sm" | "md" | "lg"; text?: string }) {
  const sizeClasses = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
  };
  
  return (
    <div className="flex items-center gap-3">
      <Loader2 className={`${sizeClasses[size]} animate-spin text-emerald-500`} />
      {text && <span className="text-sm text-zinc-500 dark:text-zinc-400">{text}</span>}
    </div>
  );
}

// ── Progress Steps ─────────────────────────────────────────────────────────────

export function ProgressSteps({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-colors ${
              i < currentStep
                ? "bg-emerald-500 text-[#070b0a]"
                : i === currentStep
                ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500"
                : "bg-zinc-800 text-zinc-500 border border-zinc-700"
            }`}
          >
            {i < currentStep ? <CheckCircle2 className="size-4" /> : i + 1}
          </div>
          <span
            className={`text-xs ${
              i === currentStep ? "text-zinc-100" : "text-zinc-500"
            }`}
          >
            {step}
          </span>
          {i < steps.length - 1 && (
            <div className={`w-8 h-px ${i < currentStep ? "bg-emerald-500" : "bg-zinc-700"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: any;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="rounded-full bg-zinc-800/50 p-4 mb-4">
        <Icon className="size-8 text-zinc-500" />
      </div>
      <h3 className="text-lg font-semibold text-zinc-100 mb-2">{title}</h3>
      <p className="text-sm text-zinc-500 max-w-sm mb-4">{description}</p>
      {action && action}
    </div>
  );
}

// ── Error Box with Actions ──────────────────────────────────────────────────────

export function ErrorBox({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
          {(onRetry || onDismiss) && (
            <div className="flex gap-2 mt-3">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 transition-colors"
                >
                  Try again
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Success Box ───────────────────────────────────────────────────────────────

export function SuccessBox({ message, subtext }: { message: string; subtext?: string }) {
  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="size-5 text-emerald-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{message}</p>
          {subtext && <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">{subtext}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Card Component ────────────────────────────────────────────────────────────

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>
      {children}
    </div>
  );
}

// ── Input Field with Validation ───────────────────────────────────────────────

export function InputField({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  disabled,
  min,
  step,
  className = "",
}: {
  label?: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  disabled?: boolean;
  min?: string;
  step?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        min={min}
        step={step}
        className={`w-full rounded-lg border px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 transition-all ${
          error
            ? "border-red-300 dark:border-red-800 focus:ring-red-500"
            : "border-white/10 focus:ring-emerald-500 bg-white/[0.03]"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ── Button Variants ───────────────────────────────────────────────────────────

export function Button({
  children,
  variant = "primary",
  disabled,
  loading,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const variants = {
    primary: "bg-emerald-500 text-[#070b0a] hover:bg-emerald-400",
    secondary: "border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
    ghost: "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
