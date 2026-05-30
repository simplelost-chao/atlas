export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Atlas</h1>
          <p className="mt-1 text-sm text-gray-500">产业链分析平台</p>
        </div>
        {children}
      </div>
    </div>
  );
}
