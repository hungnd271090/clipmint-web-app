import Link from "next/link";
import { ClipMintApp } from "@/components/ClipMintApp";

export default function Home() {
  return (
    <>
      <div className="fixed right-4 top-4 z-50">
        <Link
          href="/meta-ai"
          className="inline-flex rounded-full border border-violet-200 bg-white/95 px-4 py-2 text-sm font-bold text-violet-700 shadow-sm backdrop-blur hover:bg-violet-50"
        >
          Meta AI Flow →
        </Link>
      </div>
      <ClipMintApp />
    </>
  );
}
