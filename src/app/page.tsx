import Game from "@/components/Game";
import { SITE } from "@/lib/site";
import { groupPlayAvailable } from "@/lib/store";

/**
 * 정적 프리렌더를 끕니다.
 *
 * 프리렌더하면 `groupPlayAvailable()`이 **빌드 시점에** 평가됩니다. Upstash를
 * 나중에 연결하면 API는 살아나는데 화면에서는 그룹 UI가 계속 숨어 있어서
 * "서버는 되는데 UI가 없다"는 상태가 됩니다. 요청 시점에 판단하게 둡니다.
 * (`NEXT_PUBLIC_KAKAO_JS_KEY`는 번들에 구워지므로 여전히 재배포가 필요합니다)
 */
export const dynamic = "force-dynamic";

/**
 * 서버에서 환경 설정만 읽어 넘깁니다. REST 키·Upstash 토큰은 여기서도
 * 클라이언트로 나가지 않고, "있다/없다"만 불리언으로 전달합니다.
 */
export default function Page() {
  // 검색엔진이 "블로그 글"이 아니라 "웹 도구"로 인식하도록
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE.name,
    alternateName: "Random Pick",
    url: SITE.url,
    description: SITE.description,
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Any",
    inLanguage: "ko",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
  };

  return (
    <>
      <script
        type="application/ld+json"
        // 우리가 만든 상수만 직렬화합니다 — 사용자 입력이 들어오는 경로가 아닙니다
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Game
        jsKey={process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? ""}
        liveData={Boolean(process.env.KAKAO_REST_KEY)}
        groupEnabled={groupPlayAvailable()}
      />
    </>
  );
}
