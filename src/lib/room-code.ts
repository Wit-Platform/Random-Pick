/**
 * 초대 코드. Crockford Base32에서 혼동 문자(I L O U)를 뺀 32자를 씁니다.
 * 사람이 받아 적고 입력하는 값이라 오탈자 보정이 중요합니다.
 */

import { GROUP } from "./config";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ROOM_CODE_LENGTH = GROUP.codeLength;

export function generateRoomCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? "0";
  }
  return out;
}

/**
 * 소문자·공백·하이픈을 정리하고 혼동 문자를 보정합니다. I/L → 1, O → 0, U → V.
 * 길이는 자르지 않습니다 — 자르면 7자 오타가 다른 방으로 조용히 들어갑니다.
 */
function cleanRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
}

export function normalizeRoomCode(input: string): string {
  return cleanRoomCode(input).slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(input: string): boolean {
  const code = cleanRoomCode(input);
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((ch) => ALPHABET.includes(ch));
}
