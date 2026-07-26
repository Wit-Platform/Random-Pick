import Link from "next/link";

import { CONTACT_EMAIL, SITE } from "@/lib/site";

/**
 * 패널 최하단. 약관·처리방침과 피드백 창구를 둡니다.
 *
 * mailto 본문에 무엇을 적어주면 좋은지 미리 채워둡니다 — 빈 메일 앞에서 사람들은
 * 대개 아무것도 쓰지 않습니다.
 */
export default function SiteFooter() {
  const subject = encodeURIComponent(`[${SITE.name}] 개발자에게 한마디`);
  const body = encodeURIComponent(
    [
      "무엇이 좋았거나 아쉬웠는지 편하게 적어주세요.",
      "",
      "─────────────",
      "· 어떤 상황에서 쓰셨나요:",
      "· 아쉬웠던 점:",
      "· 있으면 좋겠는 기능:",
      "",
      "(문제 상황이면 아래도 함께 적어주시면 원인을 찾기 쉽습니다)",
      "· 기기 / 브라우저:",
      "· 방 코드(그룹 이용 시):",
    ].join("\n"),
  );

  return (
    <footer className="site-footer">
      <a
        className="btn block feedback"
        href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}
      >
        개발자에게 한마디
      </a>

      <nav className="footer-links">
        <Link href="/terms">이용약관</Link>
        <span aria-hidden="true">·</span>
        <Link href="/privacy">개인정보 · 위치정보</Link>
      </nav>

      <p className="footer-note">
        식당 정보는 카카오 로컬 API에서 받아옵니다. 영업 여부와 영업시간은 방문 전에
        확인해주세요. 현재 위치는 서버에 저장하지 않습니다.
      </p>
    </footer>
  );
}
