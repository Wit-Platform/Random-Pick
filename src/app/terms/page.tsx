import Link from "next/link";
import type { Metadata } from "next";

import { POLICY_EFFECTIVE_DATE, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `이용약관 — ${SITE.name}`,
  description: `${SITE.name} 서비스 이용약관`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <main className="doc">
      <p className="doc-back">
        <Link href="/">← {SITE.name}으로 돌아가기</Link>
      </p>

      <h1>이용약관</h1>
      <p className="doc-meta">시행일 {POLICY_EFFECTIVE_DATE}</p>

      <h2>1. 서비스 내용</h2>
      <p>
        {SITE.name}(이하 &ldquo;서비스&rdquo;)은 지도 위에 던진 지점을 기준으로 근처
        식당을 무작위로 제안하는 <strong>오락 목적의 웹 서비스</strong>입니다. 회원가입이
        없으며 별도의 이용료도 없습니다.
      </p>

      <h2>2. 식당 정보의 출처와 한계</h2>
      <p>
        서비스가 보여주는 식당 정보는 <strong>카카오 로컬 API</strong>에서 제공받은 것으로,
        서비스가 직접 수집하거나 검증한 것이 아닙니다. 따라서 다음을 보증하지 않습니다.
      </p>
      <ul>
        <li>영업 여부, 영업시간, 휴무일</li>
        <li>메뉴, 가격, 실제 위치</li>
        <li>폐업·이전 여부</li>
      </ul>
      <p>
        방문 전에 반드시 직접 확인해주세요. 카카오 API가 검색당 최대 45건만 제공하는 등의
        제약이 있어, 근처의 모든 식당이 후보에 포함되지는 않습니다.
      </p>

      <h2>3. 결과의 성격</h2>
      <p>
        던지기 결과는 <strong>무작위 요소가 섞인 오락적 제안</strong>이며 어떤 형태의 추천·
        보증·광고도 아닙니다. 특정 업소와 제휴 관계가 없고 대가를 받지 않습니다. 결과에
        따른 방문·결제·식사에서 발생한 문제에 대해 서비스는 책임지지 않습니다.
      </p>

      <h2>4. 이용자가 하지 말아야 할 것</h2>
      <ul>
        <li>자동화된 수단으로 대량·반복 요청을 보내는 행위</li>
        <li>서비스의 API를 서비스 화면 밖에서 임의로 호출하는 행위</li>
        <li>그룹 기능에 타인의 개인정보나 불쾌감을 주는 표현을 입력하는 행위</li>
      </ul>
      <p>
        서비스는 외부 API 사용량을 보호하기 위해 IP 단위 요청 제한을 두고 있습니다. 제한을
        초과하면 일시적으로 요청이 거부됩니다.
      </p>

      <h2>5. 그룹 기능</h2>
      <p>
        초대 코드를 아는 사람은 누구나 해당 방의 결과 목록을 볼 수 있습니다.
        <strong> &ldquo;이걸로 결정&rdquo;을 누르면 입력한 닉네임과 식당 이름이 방에 참여한
        모든 사람에게 공개됩니다.</strong> 공개를 원하지 않으면 누르지 마세요. 방과 기록은
        12시간 후 자동으로 삭제됩니다.
      </p>

      <h2>6. 서비스 변경과 중단</h2>
      <p>
        개인이 운영하는 서비스로, 사전 통지 없이 기능이 변경되거나 서비스가 중단될 수
        있습니다. 외부 API의 사용량 한도에 도달하면 실제 식당 데이터 대신 샘플 데이터로
        동작하며, 이때는 화면에 그 사실을 표시합니다.
      </p>

      <h2>7. 문의</h2>
      <p>
        {/* 메일 앱을 열지 않고 사이트에서 바로 보냅니다 */}
        <Link href="/#feedback">개발자에게 한마디 남기기 →</Link>
      </p>

      <p className="doc-back doc-back-bottom">
        <Link href="/privacy">개인정보 · 위치정보 처리방침 →</Link>
      </p>
    </main>
  );
}
