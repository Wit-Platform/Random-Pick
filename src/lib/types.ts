export interface LatLng {
  lat: number;
  lng: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 게임에서 쓰는 음식 대분류. 카카오 category_name을 이 7개로 접어서 씁니다. */
export type CategoryId = "ko" | "cn" | "jp" | "we" | "bs" | "cf" | "et";

export interface Place {
  /** 카카오 place id, 또는 mock의 결정론적 id */
  id: string;
  name: string;
  cat: CategoryId;
  /** 카카오 원본 세부 분류 ("한식 > 국밥"). mock은 대분류만 */
  detail: string;
  lat: number;
  lng: number;
  /** 카카오맵 상세 링크. mock 데이터에는 없음 */
  url?: string;
  road?: string;
}

/** 실데이터인지 샘플인지 — UI 배너와 결과 카드 링크 노출을 가릅니다. */
export type DataSource = "kakao" | "sample";

/**
 * 게임 상태. 조준(aiming)은 MapStage 내부에서만 다루므로 여기 없습니다 —
 * 부모가 조준 중 매 프레임 리렌더될 이유가 없습니다.
 */
export type Phase = "idle" | "flying" | "reveal" | "result";

/**
 * 왜 샘플 데이터로 내려앉았는지. 배너 문구를 정확하게 쓰기 위해 구분합니다 —
 * "키가 없다"와 "오늘 한도를 다 썼다"는 사용자에게 전혀 다른 이야기입니다.
 */
export type SampleReason = "no-key" | "budget" | "cooldown" | "error";

export interface PlacesResult {
  places: Place[];
  source: DataSource;
  /** 카카오 45건 상한에 걸려 잘렸는지 (프리뷰가 표본임을 알리는 용도) */
  truncated: boolean;
  reason?: SampleReason;
}

export interface GroupCondition {
  base: LatLng;
  radiusM: number;
  cats: CategoryId[];
  createdAt: number;
}

export interface GroupThrow {
  /** 투표 대상을 지목하기 위한 식별자. 서버가 붙입니다 */
  id: string;
  nick: string;
  placeName: string;
  cat: CategoryId;
  distM: number;
  ts: number;
}

/** 붐업(찬성) / 붐따(반대) */
export type VoteValue = "up" | "down";

export interface GroupThrowWithVotes extends GroupThrow {
  up: number;
  down: number;
  /** 이 브라우저가 던진 표. 없으면 null */
  myVote: VoteValue | null;
}
