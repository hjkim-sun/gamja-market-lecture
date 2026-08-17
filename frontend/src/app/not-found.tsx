import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
      <Image
        src="/gamja-mascot.png"
        alt="당황한 감자마켓 마스코트"
        width={140}
        height={140}
        className="h-32 w-32 object-contain opacity-90"
      />
      <h1 className="text-xl font-extrabold text-[#4a2f1c]">
        앗, 페이지를 찾을 수 없어요
      </h1>
      <p className="text-sm text-[#8a6a4a]">
        요청하신 구매요청이 존재하지 않거나 삭제되었을 수 있어요.
      </p>
      <Link
        href="/requests"
        className="mt-2 rounded-full bg-[#d9822b] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#c47523]"
      >
        구매요청 목록으로 가기
      </Link>
    </div>
  );
}
