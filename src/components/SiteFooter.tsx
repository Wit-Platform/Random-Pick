import Link from "next/link";

import FeedbackForm from "./FeedbackForm";

/** 패널 최하단. 피드백 창구와 약관·처리방침을 둡니다. */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <FeedbackForm />

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
