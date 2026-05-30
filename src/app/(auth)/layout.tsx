export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111827]">
      <div className="w-full max-w-md space-y-6 p-8">
        <div className="flex flex-col items-center gap-2">
          <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
            <path d="M32 8L54 52H42L38 44H26L22 52H10L32 8ZM29 36H35L32 28L29 36Z" fill="#C59D5F" />
          </svg>
          <h1 className="text-2xl font-bold tracking-widest text-white">ATLAS</h1>
          <p className="text-sm text-[#6B7280]">产业链分析平台</p>
        </div>
        {children}
      </div>
    </div>
  );
}
