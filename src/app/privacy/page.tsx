import Link from "next/link";
import type { Metadata } from "next";

import { GROUP } from "@/lib/config";
import { POLICY_EFFECTIVE_DATE, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `개인정보 · 위치정보 처리방침 — ${SITE.name}`,
  description: `${SITE.name}이 위치정보와 개인정보를 어떻게 다루는지에 대한 안내`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="doc">
      <p className="doc-back">
        <Link href="/">← {SITE.name}으로 돌아가기</Link>
      </p>

      <h1>개인정보 · 위치정보 처리방침</h1>
      <p className="doc-meta">시행일 {POLICY_EFFECTIVE_DATE}</p>

      <div className="doc-callout">
        <p>
          회원가입이 없고 계정을 만들지 않습니다. <strong>이용자의 현재 위치는 서버에
          저장하지 않습니다.</strong> 브라우저에 남는 것은 닉네임 하나뿐입니다.
        </p>
      </div>

      <h2>1. 위치정보</h2>
      <h3>수집 방법과 목적</h3>
      <p>
        &ldquo;현재 위치&rdquo; 버튼을 누르거나 서비스를 처음 열 때, 브라우저의 위치 권한
        요청을 통해 현재 좌표를 받습니다. <strong>권한을 거부하면 지도를 직접 탭해서
        기준점을 정할 수 있고, 서비스의 나머지 기능은 그대로 이용할 수 있습니다.</strong>
      </p>
      <p>좌표는 다음 목적으로만 쓰입니다.</p>
      <ul>
        <li>지도의 시작 위치와 던지기의 기준점 설정</li>
        <li>돌이 떨어진 지점 주변 식당 조회</li>
      </ul>

      <h3>저장하지 않는 것</h3>
      <p>
        이용자의 현재 위치는 <strong>서버에 저장하지 않습니다.</strong> 브라우저 메모리에만
        있다가 탭을 닫으면 사라집니다.
      </p>

      <h3>전송되는 것</h3>
      <p>
        식당을 조회하려면 좌표가 서비스 서버로 전송되고, 서버가 이를 카카오에 전달합니다.
        조회 결과는 외부 API 사용량을 줄이기 위해 <strong>약 10분간 캐시</strong>되며, 이때
        캐시 키에 <strong>약 11~110m 단위로 반올림한 좌표</strong>가 포함됩니다. 이 값은
        이용자를 식별할 수 있는 정보와 연결되지 않습니다.
      </p>

      <h2>2. 그룹 기능에서 저장하는 것</h2>
      <p>
        &ldquo;이걸로 결정&rdquo;을 누를 때만 저장합니다. 던질 때마다 자동으로 저장되지
        않습니다.
      </p>
      <div className="doc-table">
        <table>
          <thead>
            <tr>
              <th>항목</th>
              <th>보관기간</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>닉네임 (최대 {GROUP.maxNickLength}자, 직접 입력)</td>
              <td>12시간</td>
            </tr>
            <tr>
              <td>식당 이름, 음식 종류, 기준점으로부터의 거리, 시각</td>
              <td>12시간</td>
            </tr>
            <tr>
              <td>방장이 정한 기준점 좌표 · 반경 · 음식 종류</td>
              <td>12시간</td>
            </tr>
            <tr>
              <td>
                붐업 · 붐따 투표 수, 그리고 어떤 브라우저가 어떻게 투표했는지
              </td>
              <td>12시간</td>
            </tr>
            <tr>
              <td>
                참가자 목록 (닉네임과 마지막 접속 시각). 25초 넘게 소식이 없으면
                목록에서 빠집니다
              </td>
              <td>12시간</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        방장이 정한 기준점은 <strong>모임 장소</strong>이지 개인의 현재 위치가 아닙니다.
        방과 기록은 12시간이 지나면 자동으로 삭제되며, 이용자가 별도로 요청할 필요가
        없습니다.
      </p>
      <p>
        <strong>초대 코드를 아는 사람은 누구나 그 방의 기록을 볼 수 있습니다.</strong> 닉네임에
        실명이나 연락처를 넣지 마세요. 방을 만든 사람은 인원이 모인 뒤
        <strong> 새 참가를 막을 수 있습니다.</strong>
      </p>
      <p>
        올린 결과는 <strong>본인이 직접 내릴 수 있습니다</strong> (목록의 ✕). 방을 나가도
        이미 올린 결과는 남으므로, 지우려면 나가기 전에 내려주세요.
      </p>

      <h2>3. 브라우저에 저장하는 것</h2>
      <p>
        <code>localStorage</code>에 두 가지만 저장합니다.
      </p>
      <ul>
        <li>
          <strong>닉네임</strong> — 매번 다시 입력하지 않도록
        </li>
        <li>
          <strong>투표자 식별자</strong> — 계정이 없어서, 중복 투표를 막고 눌렀던 표를
          되돌릴 수 있게 브라우저마다 임의의 문자열을 하나 만들어 둡니다. 개인을 식별하는
          값이 아니며 닉네임이나 다른 정보와 연결하지 않습니다. 브라우저를 바꾸면 새로
          만들어지므로 <strong>엄격한 1인 1표를 보장하지는 않습니다.</strong>
        </li>
      </ul>
      <p>
        브라우저 설정에서 사이트 데이터를 지우면 둘 다 삭제됩니다. 광고·분석용 쿠키나 추적
        스크립트는 사용하지 않습니다.
      </p>

      <h2>4. 요청 제한을 위한 IP 사용</h2>
      <p>
        외부 API 사용량을 보호하기 위해 IP 주소를 키로 한 요청 횟수 카운터를 두고 있습니다.
        이 카운터는 <strong>최대 10분 후 자동 만료</strong>되며, 다른 정보와 결합하지 않고
        요청 제한 목적으로만 사용합니다. 이와 별개로 호스팅 사업자(Vercel)의 접근 로그가
        플랫폼 기본 정책에 따라 기록될 수 있습니다.
      </p>

      <h2>5. 개발자에게 한마디</h2>
      <p>
        보내주신 내용은 적어주신 글, 답장 주소(선택), <strong>브라우저 종류(User-Agent)</strong>,
        받은 시각이 함께 전달됩니다. 문제 상황을 재현하는 데 브라우저 정보가 필요해서입니다.
        <strong>IP 주소는 전달하지 않습니다</strong> — 요청 제한 목적으로만 쓰입니다.
      </p>
      <p>
        내용은 메일로 발송되며, 발송이 실패하더라도 사라지지 않도록 <strong>30일간</strong>
        저장한 뒤 자동 삭제됩니다. 답장 주소를 비워두시면 회신하지 않습니다.
      </p>

      <h2>6. 처리를 위탁하는 곳</h2>
      <div className="doc-table">
        <table>
          <thead>
            <tr>
              <th>수탁자</th>
              <th>목적</th>
              <th>전달되는 정보</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>카카오</td>
              <td>지도 표시, 장소 검색</td>
              <td>지도·검색 요청 좌표</td>
            </tr>
            <tr>
              <td>Vercel</td>
              <td>호스팅</td>
              <td>접속 기록(IP 등)</td>
            </tr>
            <tr>
              <td>Upstash</td>
              <td>조회 캐시, 그룹 기록, 한마디 보관</td>
              <td>2 · 4 · 5항의 항목</td>
            </tr>
            <tr>
              <td>Resend</td>
              <td>한마디 메일 발송</td>
              <td>5항의 항목</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>7. 이용자의 권리</h2>
      <ul>
        <li>
          <strong>위치 권한 철회</strong> — 브라우저 사이트 설정에서 언제든 취소할 수
          있습니다. 취소해도 지도를 탭해 기준점을 정하면 그대로 이용할 수 있습니다.
        </li>
        <li>
          <strong>닉네임 삭제</strong> — 브라우저의 사이트 데이터 삭제
        </li>
        <li>
          <strong>그룹 기록</strong> — 12시간 후 자동 삭제. 즉시 삭제를 원하면 아래 문의로
          방 코드를 알려주세요.
        </li>
      </ul>

      <h2>8. 문의</h2>
      <p>
        {/* 메일 앱을 열지 않고 사이트에서 바로 보냅니다 */}
        <Link href="/#feedback">개발자에게 한마디 남기기 →</Link>
      </p>

      <p className="doc-back doc-back-bottom">
        <Link href="/terms">이용약관 →</Link>
      </p>
    </main>
  );
}
