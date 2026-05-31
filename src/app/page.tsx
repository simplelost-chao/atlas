import Link from "next/link";
import { AtlasLogo } from "@/components/atlas-logo";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#111827] text-white">
      <div className="flex flex-col items-center gap-6 px-4">
        {/* Logo */}
        <AtlasLogo size={80} animated variant="dark" />
        <h1 className="text-4xl font-bold tracking-widest">ATLAS</h1>
        <p className="text-center text-lg text-[#6B7280]">
          Map Industries. Find Companies. Discover Value.
        </p>

        {/* Feature icons */}
        <div className="mt-8 flex gap-12">
          <div className="flex flex-col items-center gap-2">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C59D5F" strokeWidth="1.5">
              <path d="M3.5 5.5L12 2l8.5 3.5v6c0 5.5-3.5 10-8.5 12-5-2-8.5-6.5-8.5-12v-6z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs font-medium text-[#C59D5F]">INDUSTRY MAP</span>
            <span className="text-xs text-[#6B7280]">产业图谱</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C59D5F" strokeWidth="1.5">
              <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
              <circle cx="12" cy="12" r="6" />
              <path d="M12 9v6m-3-3h6" />
            </svg>
            <span className="text-xs font-medium text-[#C59D5F]">VALUE FLOW</span>
            <span className="text-xs text-[#6B7280]">价值流向</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C59D5F" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span className="text-xs font-medium text-[#C59D5F]">COMPANY DISCOVERY</span>
            <span className="text-xs text-[#6B7280]">公司发现</span>
          </div>
        </div>

        {/* CTA */}
        <Link
          href="/login"
          className="mt-10 rounded-lg bg-[#C59D5F] px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-[#D4AD6F] hover:shadow-lg hover:shadow-[#C59D5F]/20"
        >
          开始使用
        </Link>
      </div>
    </main>
  );
}
