import Game from "@/components/Game";
import { groupPlayAvailable } from "@/lib/store";

/**
 * 서버에서 환경 설정만 읽어 넘깁니다. REST 키·Upstash 토큰은 여기서도
 * 클라이언트로 나가지 않고, "있다/없다"만 불리언으로 전달합니다.
 */
export default function Page() {
  return (
    <Game
      jsKey={process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? ""}
      liveData={Boolean(process.env.KAKAO_REST_KEY)}
      groupEnabled={groupPlayAvailable()}
    />
  );
}
